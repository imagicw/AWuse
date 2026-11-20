import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BatchModalKind,
  FinderBatchRule,
  FinderRuleMode,
  FinderRuleTarget,
  OnlineSearchResult,
  ReorganizePreviewItem,
  ReorganizeRule,
  StagedChange,
  TagPatch,
  TrackRecord,
  TransactionRecord,
} from "../types/music";
import {
  applyFinderBatchRule,
  convertTraditionalSimplified,
  looksLikeMojibake,
  normalizeCjkPunctuation,
  repairMojibake,
  toPinyinSortKey,
} from "../services/cjkAndBatchEngine";
import {
  bridgePlanAlbumUnification,
  bridgePreviewReorganize,
  bridgeSearchOnlineReleases,
  bridgeVerifyFlacMd5,
} from "../services/bridge";
import { IconClose, IconShieldCheck } from "./Icons";

interface BatchModalsProps {
  modalKind: BatchModalKind;
  onClose: () => void;
  targetTracks: TrackRecord[];
  allTracks: TrackRecord[];
  stagedChanges: StagedChange[];
  transactions: TransactionRecord[];
  onStageChanges: (changes: StagedChange[]) => void;
  onUnstageTrack: (trackId: string) => void;
  onDiscardAllStaged: () => void;
  onCommitStaged: () => void;
  onRevertTransaction: (txId: string) => void;
  onUpdateTrackMd5Status: (
    trackId: string,
    status: TrackRecord["specs"]["md5Verified"]
  ) => void;
}

// Top-layer exit animation helper per modern-web-guidance animate-to-from-top-layer
let cachedSupportsDisplayTransition: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (cachedSupportsDisplayTransition !== undefined) {
    return cachedSupportsDisplayTransition;
  }
  if (
    typeof window === "undefined" ||
    !window.CSS?.supports?.("transition-behavior", "allow-discrete") ||
    !document.body
  ) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText =
    "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  cachedSupportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return cachedSupportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.CSS?.supports?.("overlay", "auto")) &&
    canTransitionDisplay()
  );
}

async function closeTopLayer(dialog: HTMLDialogElement) {
  if (!dialog.open) return;
  if (!supportsTopLayerExit()) {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 300)),
      ]);
    }
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open) dialog.close();
}

export const BatchModals: React.FC<BatchModalsProps> = ({
  modalKind,
  onClose,
  targetTracks,
  allTracks,
  stagedChanges,
  transactions,
  onStageChanges,
  onUnstageTrack,
  onDiscardAllStaged,
  onCommitStaged,
  onRevertTransaction,
  onUpdateTrackMd5Status,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // 1. Reorganize state
  const [reorgRule, setReorgRule] = useState<ReorganizeRule>({
    rootDir: "/Users/imagic/Music/Lossless",
    template: "{AlbumArtist}/{Year} - {Album}/{TrackNumber} - {Title}.{ext}",
    moveCompanions: true,
    cleanupEmptyDirs: true,
    zeroPadTrack: true,
  });
  const [reorgPreview, setReorgPreview] = useState<ReorganizePreviewItem[]>([]);

  // 2. Unify state
  const [unifyPreview, setUnifyPreview] = useState<StagedChange[]>([]);

  // 3. Finder-style Batch Rule Modifier state
  const [finderRule, setFinderRule] = useState<FinderBatchRule>({
    targetField: "fileName",
    mode: "replace",
    findText: "",
    replaceText: "",
    useRegex: false,
    caseSensitive: false,
    addText: "",
    addPosition: "before",
    formatBaseMode: "keep",
    customBaseText: "Track",
    formatPosition: "before",
    separator: " - ",
    startIndex: 1,
    step: 1,
    zeroPad: 2,
    templateDirection: "extract_from_filename",
    extractPattern: "%track% - %artist% - %title%",
    renamePattern: "{TrackNumber} - {Artist} - {Title}",
    zeroPadTrack: true,
  });

  // 4. CJK state
  const [cjkFixMojibake, setCjkFixMojibake] = useState(true);
  const [cjkEncoding, setCjkEncoding] = useState<"gb18030" | "big5" | "shift_jis">("gb18030");
  const [cjkNormPunct, setCjkNormPunct] = useState(true);
  const [cjkConvDir, setCjkConvDir] = useState<"none" | "t2s" | "s2t">("none");
  const [cjkGenSort, setCjkGenSort] = useState(true);

  // 5. Scraper state
  const [scraperSource, setScraperSource] =
    useState<OnlineSearchResult["source"]>("itunes");
  const [scraperQuery, setScraperQuery] = useState("");
  const [scraperResults, setScraperResults] = useState<OnlineSearchResult[]>([]);
  const [scraperLoading, setScraperLoading] = useState(false);

  // 6. Staged Queue tab
  const [queueTab, setQueueTab] = useState<"staged" | "history">("staged");

  // 7. MD5 audit state
  const [auditing, setAuditing] = useState(false);

  // Open / close native dialog cleanly
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (modalKind) {
      if (!dlg.open) {
        dlg.returnValue = "";
        dlg.showModal();
      }
    } else if (dlg.open) {
      closeTopLayer(dlg);
    }
  }, [modalKind]);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      closeTopLayer(dlg).then(() => onClose());
    };
    const handleClose = () => {
      dlg.returnValue = "";
      onClose();
    };
    dlg.addEventListener("cancel", handleCancel);
    dlg.addEventListener("close", handleClose);
    return () => {
      dlg.removeEventListener("cancel", handleCancel);
      dlg.removeEventListener("close", handleClose);
    };
  }, [onClose]);

  const requestClose = () => {
    const dlg = dialogRef.current;
    if (dlg) {
      closeTopLayer(dlg).then(() => onClose());
    } else {
      onClose();
    }
  };

  // Refresh previews when modal opens
  useEffect(() => {
    if (modalKind === "reorganize") {
      bridgePreviewReorganize(targetTracks, reorgRule).then(setReorgPreview);
    }
  }, [modalKind, targetTracks, reorgRule]);

  useEffect(() => {
    if (modalKind === "unify") {
      bridgePlanAlbumUnification(targetTracks).then(setUnifyPreview);
    }
  }, [modalKind, targetTracks]);

  useEffect(() => {
    if (modalKind === "scraper") {
      const first = targetTracks[0];
      const defaultQ = first
        ? `${first.albumArtist || first.artist} ${first.album}`.trim()
        : "";
      setScraperQuery(defaultQ);
      if (defaultQ) {
        setScraperLoading(true);
        bridgeSearchOnlineReleases(scraperSource, defaultQ)
          .then(setScraperResults)
          .finally(() => setScraperLoading(false));
      } else {
        setScraperResults([]);
      }
    }
  }, [modalKind]);

  // Finder-style batch rule live preview
  const finderRegexValid = useMemo(() => {
    if (finderRule.mode !== "replace" || !finderRule.useRegex || !finderRule.findText) {
      return true;
    }
    try {
      new RegExp(finderRule.findText);
      return true;
    } catch {
      return false;
    }
  }, [finderRule.mode, finderRule.useRegex, finderRule.findText]);

  const finderChanges = useMemo<StagedChange[]>(() => {
    if (modalKind !== "filename") return [];
    return applyFinderBatchRule(targetTracks, finderRule);
  }, [modalKind, targetTracks, finderRule]);

  const finderCollisionPaths = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of finderChanges) {
      if (c.patch.newFilePath) {
        const key = c.patch.newFilePath.toLowerCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const dupes = new Set<string>();
    for (const [k, n] of counts) {
      if (n > 1) dupes.add(k);
    }
    return dupes;
  }, [finderChanges]);

  // CJK Cleaner live preview
  const cjkChanges = useMemo<StagedChange[]>(() => {
    if (modalKind !== "cjk") return [];
    const changes: StagedChange[] = [];

    const transformText = (txt: string) => {
      let val = txt;
      if (cjkFixMojibake && looksLikeMojibake(val)) {
        val = repairMojibake(val, cjkEncoding);
      }
      if (cjkNormPunct) {
        val = normalizeCjkPunctuation(val);
      }
      if (cjkConvDir !== "none") {
        val = convertTraditionalSimplified(val, cjkConvDir);
      }
      return val;
    };

    for (const t of targetTracks) {
      const patch: TagPatch = {};
      const nextTitle = transformText(t.title);
      const nextArtist = transformText(t.artist);
      const nextAa = transformText(t.albumArtist);
      const nextAlbum = transformText(t.album);

      if (nextTitle !== t.title) patch.title = nextTitle;
      if (nextArtist !== t.artist) patch.artist = nextArtist;
      if (nextAa !== t.albumArtist) patch.albumArtist = nextAa;
      if (nextAlbum !== t.album) patch.album = nextAlbum;

      if (cjkGenSort) {
        const baseArtist = nextAa || nextArtist;
        const aSort = toPinyinSortKey(baseArtist);
        const albSort = toPinyinSortKey(nextAlbum);
        if (aSort && aSort !== t.artistSort) patch.artistSort = aSort;
        if (albSort && albSort !== t.albumSort) patch.albumSort = albSort;
      }

      if (Object.keys(patch).length > 0) {
        changes.push({
          trackId: t.id,
          patch,
          reason: "CJK 编码修复 / 繁简标点与拼音规范化",
        });
      }
    }
    return changes;
  }, [modalKind, targetTracks, cjkFixMojibake, cjkEncoding, cjkNormPunct, cjkConvDir, cjkGenSort]);

  const trackById = useMemo(
    () => new Map(allTracks.map((t) => [t.id, t])),
    [allTracks]
  );

  const modalTitles: Record<Exclude<BatchModalKind, null>, string> = {
    reorganize: `物理目录重整引擎 (${targetTracks.length} 首作用目标)`,
    unify: `散碎专辑与 Feat. 歌手归并 (${targetTracks.length} 首扫描目标)`,
    filename: `Finder 式批量规则修改器 (${targetTracks.length} 首作用目标)`,
    cjk: `CJK 曲库清洗与拼音排序标签生成 (${targetTracks.length} 首)`,
    scraper: `全球 / 华语多源元数据与高清封面刮削`,
    staged_queue: `暂存事务队列与历史回滚`,
    md5_audit: `无损音频流与 FLAC MD5 完整性巡检`,
  };

  return (
    <dialog
      ref={dialogRef}
      className="ada-dialog"
      aria-labelledby="ada-modal-title"
    >
      <div className="dialog-head">
        <h2 id="ada-modal-title">
          {modalKind ? modalTitles[modalKind] : ""}
        </h2>
        <button
          type="button"
          className="tool-btn icon-only"
          aria-label="关闭窗口"
          onClick={requestClose}
        >
          <IconClose size={14} />
        </button>
      </div>

      {/* 1. Directory Reorganizer */}
      {modalKind === "reorganize" && (
        <>
          <div className="dialog-body scroller">
            <div className="inspector-field-grid">
              <div className="field-group">
                <label className="field-label" htmlFor="reorg-root">
                  目标媒体库根目录
                </label>
                <input
                  id="reorg-root"
                  type="text"
                  className="field-input mono"
                  value={reorgRule.rootDir}
                  onChange={(e) =>
                    setReorgRule({ ...reorgRule, rootDir: e.target.value })
                  }
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="reorg-tpl">
                  目录与文件命名模板
                </label>
                <input
                  id="reorg-tpl"
                  type="text"
                  className="field-input mono"
                  value={reorgRule.template}
                  onChange={(e) =>
                    setReorgRule({ ...reorgRule, template: e.target.value })
                  }
                />
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
              <span style={{ fontSize: "11.5px", color: "var(--text-tertiary)" }}>预设模板：</span>
              {[
                "{AlbumArtist}/{Year} - {Album}/{TrackNumber} - {Title}.{ext}",
                "{AlbumArtist}/{Album}/CD{DiscNumber}/{TrackNumber}. {Title}.{ext}",
                "{Format}/{AlbumArtist}/{Year} - {Album}/{TrackNumber} {Title}.{ext}",
              ].map((tpl) => (
                <button
                  key={tpl}
                  type="button"
                  className="chip-btn mono"
                  onClick={() => setReorgRule({ ...reorgRule, template: tpl })}
                >
                  {tpl}
                </button>
              ))}
            </div>

            <div style={{ display: "flex", gap: "16px", fontSize: "12px" }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={reorgRule.moveCompanions}
                  onChange={(e) =>
                    setReorgRule({ ...reorgRule, moveCompanions: e.target.checked })
                  }
                />
                <span>同步迁移同名 .lrc / .cue / .log / cover.jpg</span>
              </label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={reorgRule.cleanupEmptyDirs}
                  onChange={(e) =>
                    setReorgRule({
                      ...reorgRule,
                      cleanupEmptyDirs: e.target.checked,
                    })
                  }
                />
                <span>移动后自动清理空目录</span>
              </label>
            </div>

            <table className="diff-table">
              <thead>
                <tr>
                  <th scope="col">当前路径</th>
                  <th scope="col">重整后目标路径 (Dry-Run Diff)</th>
                  <th scope="col" style={{ width: "90px" }}>
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {reorgPreview.slice(0, 40).map((item) => (
                  <tr key={item.trackId}>
                    <td className="mono diff-old" style={{ maxWidth: "240px", wordBreak: "break-all" }}>
                      {item.oldPath}
                    </td>
                    <td className={`mono ${item.changed ? "diff-new" : ""}`} style={{ maxWidth: "280px", wordBreak: "break-all" }}>
                      {item.newPath}
                      {item.companionFiles.length > 0 && (
                        <div style={{ fontSize: "10.5px", color: "var(--text-tertiary)" }}>
                          + 附属迁移: {item.companionFiles.map((f) => f.split("/").pop()).join(", ")}
                        </div>
                      )}
                    </td>
                    <td>
                      {item.conflict ? (
                        <span className="diff-conflict">路径冲突</span>
                      ) : item.changed ? (
                        <span style={{ color: "var(--staged)" }}>待迁移</span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)" }}>已规范</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              共 {reorgPreview.filter((i) => i.changed && !i.conflict).length} 条路径变更可暂存
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                取消
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={reorgPreview.filter((i) => i.changed && !i.conflict).length === 0}
                onClick={() => {
                  const changes: StagedChange[] = reorgPreview
                    .filter((i) => i.changed && !i.conflict)
                    .map((i) => ({
                      trackId: i.trackId,
                      patch: { newFilePath: i.newPath },
                      reason: "目录重整归档",
                    }));
                  onStageChanges(changes);
                  requestClose();
                }}
              >
                暂存路径变更队列
              </button>
            </div>
          </div>
        </>
      )}

      {/* 2. Fragmented Album Unifier */}
      {modalKind === "unify" && (
        <>
          <div className="dialog-body scroller">
            <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-secondary)" }}>
              自动扫描同专辑目录内因 <code>feat.</code> / <code>/</code> 合唱歌手或缺失 <code>Album Artist</code>、<code>DiscNumber</code> 造成的分拆问题，并生成归并方案。
            </p>
            {unifyPreview.length === 0 ? (
              <div style={{ padding: "24px", textAlign: "center", color: "var(--text-tertiary)" }}>
                所选范围内的专辑歌手与碟号均已高度一致，未发现散碎专辑。
              </div>
            ) : (
              <table className="diff-table">
                <thead>
                  <tr>
                    <th scope="col">曲目</th>
                    <th scope="col">原歌手 / Album Artist</th>
                    <th scope="col">归并后提案</th>
                  </tr>
                </thead>
                <tbody>
                  {unifyPreview.map((c) => {
                    const orig = trackById.get(c.trackId);
                    return (
                      <tr key={c.trackId}>
                        <td>{orig?.title || orig?.fileName}</td>
                        <td>
                          <div>{orig?.artist}</div>
                          <div className="diff-old">
                            AA: {orig?.albumArtist || "（空）"}
                            {orig?.album !== c.patch.album && c.patch.album ? ` · ${orig?.album}` : ""}
                          </div>
                        </td>
                        <td className="diff-new">
                          {c.patch.albumArtist && <div>Album Artist → {c.patch.albumArtist}</div>}
                          {c.patch.discNumber && <div>Disc → {c.patch.discNumber}</div>}
                          {c.patch.album && <div>Album → {c.patch.album}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              检测到 {unifyPreview.length} 条散碎标签可一键归并
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                关闭
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={unifyPreview.length === 0}
                onClick={() => {
                  onStageChanges(unifyPreview);
                  requestClose();
                }}
              >
                暂存归并变更 ({unifyPreview.length})
              </button>
            </div>
          </div>
        </>
      )}

      {/* 3. Finder-style Batch Rule Modifier */}
      {modalKind === "filename" && (
        <>
          <div className="dialog-body scroller">
            <div className="finder-rule-card">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div className="segmented-control" role="group" aria-label="批量规则模式">
                  {(
                    [
                      ["replace", "替换文本"],
                      ["add", "添加文本"],
                      ["format", "格式与序号"],
                      ["template", "文件名 ⇄ 标签"],
                    ] as Array<[FinderRuleMode, string]>
                  ).map(([modeKey, label]) => (
                    <button
                      key={modeKey}
                      type="button"
                      className="seg-btn"
                      aria-pressed={finderRule.mode === modeKey}
                      onClick={() =>
                        setFinderRule((prev) => ({ ...prev, mode: modeKey }))
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {finderRule.mode !== "template" && (
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <label
                      htmlFor="finder-target-field"
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      作用字段
                    </label>
                    <select
                      id="finder-target-field"
                      className="field-input"
                      style={{ width: "210px" }}
                      value={finderRule.targetField}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          targetField: e.target.value as FinderRuleTarget,
                        }))
                      }
                    >
                      <option value="fileName">物理文件名 (保留原扩展名)</option>
                      <option value="title">曲目标题 (Title)</option>
                      <option value="artist">歌手 (Artist)</option>
                      <option value="albumArtist">专辑歌手 (Album Artist)</option>
                      <option value="album">专辑名称 (Album)</option>
                      <option value="year">发行年份 (Year)</option>
                      <option value="genre">音乐流派 (Genre)</option>
                      <option value="comment">备注 (Comment)</option>
                      <option value="trackNumber">音轨号 (Track #)</option>
                    </select>
                  </div>
                )}
              </div>

              {finderRule.mode === "replace" && (
                <div className="inspector-field-grid">
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-find">
                      <span>查找内容</span>
                      {!finderRegexValid && (
                        <span style={{ color: "var(--status-danger)" }}>
                          正则语法无效
                        </span>
                      )}
                    </label>
                    <input
                      id="finder-find"
                      type="text"
                      className="field-input mono"
                      placeholder={
                        finderRule.useRegex
                          ? "例如：\\s*\\(Live\\)"
                          : "输入要查找的文字或符号…"
                      }
                      value={finderRule.findText}
                      onChange={(e) =>
                        setFinderRule((prev) => ({ ...prev, findText: e.target.value }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-replace">
                      替换为（留空即删除匹配文本）
                    </label>
                    <input
                      id="finder-replace"
                      type="text"
                      className="field-input mono"
                      placeholder="输入替换后文本…"
                      value={finderRule.replaceText}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          replaceText: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div
                    className="field-group full"
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: "18px",
                      fontSize: "12.5px",
                    }}
                  >
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="checkbox"
                        checked={finderRule.caseSensitive}
                        onChange={(e) =>
                          setFinderRule((prev) => ({
                            ...prev,
                            caseSensitive: e.target.checked,
                          }))
                        }
                      />
                      <span>区分大小写</span>
                    </label>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="checkbox"
                        checked={finderRule.useRegex}
                        onChange={(e) =>
                          setFinderRule((prev) => ({
                            ...prev,
                            useRegex: e.target.checked,
                          }))
                        }
                      />
                      <span>启用正则表达式 (RegExp)</span>
                    </label>
                  </div>
                </div>
              )}

              {finderRule.mode === "add" && (
                <div className="inspector-field-grid">
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-add-pos">
                      插入位置
                    </label>
                    <select
                      id="finder-add-pos"
                      className="field-input"
                      value={finderRule.addPosition}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          addPosition: e.target.value as "before" | "after",
                        }))
                      }
                    >
                      <option value="before">名称之前（添加前缀）</option>
                      <option value="after">
                        {finderRule.targetField === "fileName"
                          ? "名称之后 / 扩展名之前（添加后缀）"
                          : "名称之后（添加后缀）"}
                      </option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-add-text">
                      添加文本内容
                    </label>
                    <input
                      id="finder-add-text"
                      type="text"
                      className="field-input"
                      placeholder="例如：[Hi-Res] "
                      value={finderRule.addText}
                      onChange={(e) =>
                        setFinderRule((prev) => ({ ...prev, addText: e.target.value }))
                      }
                    />
                  </div>
                </div>
              )}

              {finderRule.mode === "format" && (
                <div className="inspector-field-grid">
                  {finderRule.targetField !== "trackNumber" && (
                    <>
                      <div className="field-group">
                        <label className="field-label" htmlFor="finder-fmt-base">
                          名称格式
                        </label>
                        <select
                          id="finder-fmt-base"
                          className="field-input"
                          value={finderRule.formatBaseMode}
                          onChange={(e) =>
                            setFinderRule((prev) => ({
                              ...prev,
                              formatBaseMode: e.target.value as "keep" | "custom",
                            }))
                          }
                        >
                          <option value="keep">保留原名称 + 递增序号</option>
                          <option value="custom">自定义名称 + 递增序号</option>
                        </select>
                      </div>
                      <div className="field-group">
                        <label className="field-label" htmlFor="finder-fmt-pos">
                          序号位置
                        </label>
                        <select
                          id="finder-fmt-pos"
                          className="field-input"
                          value={finderRule.formatPosition}
                          onChange={(e) =>
                            setFinderRule((prev) => ({
                              ...prev,
                              formatPosition: e.target.value as "before" | "after",
                            }))
                          }
                        >
                          <option value="before">名称之前（如 01 - 曲名）</option>
                          <option value="after">名称之后（如 曲名 - 01）</option>
                        </select>
                      </div>
                      {finderRule.formatBaseMode === "custom" && (
                        <div className="field-group">
                          <label className="field-label" htmlFor="finder-fmt-custom">
                            自定义基础名称
                          </label>
                          <input
                            id="finder-fmt-custom"
                            type="text"
                            className="field-input"
                            value={finderRule.customBaseText}
                            onChange={(e) =>
                              setFinderRule((prev) => ({
                                ...prev,
                                customBaseText: e.target.value,
                              }))
                            }
                          />
                        </div>
                      )}
                      <div className="field-group">
                        <label className="field-label" htmlFor="finder-fmt-sep">
                          连接分隔符
                        </label>
                        <input
                          id="finder-fmt-sep"
                          type="text"
                          className="field-input mono"
                          value={finderRule.separator}
                          onChange={(e) =>
                            setFinderRule((prev) => ({
                              ...prev,
                              separator: e.target.value,
                            }))
                          }
                        />
                      </div>
                    </>
                  )}
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-fmt-start">
                      起始数字
                    </label>
                    <input
                      id="finder-fmt-start"
                      type="number"
                      className="field-input mono"
                      value={finderRule.startIndex}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          startIndex: parseInt(e.target.value, 10) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor="finder-fmt-step">
                      递增步长
                    </label>
                    <input
                      id="finder-fmt-step"
                      type="number"
                      min={1}
                      className="field-input mono"
                      value={finderRule.step}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          step: Math.max(1, parseInt(e.target.value, 10) || 1),
                        }))
                      }
                    />
                  </div>
                  {finderRule.targetField !== "trackNumber" && (
                    <div className="field-group">
                      <label className="field-label" htmlFor="finder-fmt-pad">
                        补零位数 (0=不补零, 2=01)
                      </label>
                      <input
                        id="finder-fmt-pad"
                        type="number"
                        min={0}
                        max={6}
                        className="field-input mono"
                        value={finderRule.zeroPad}
                        onChange={(e) =>
                          setFinderRule((prev) => ({
                            ...prev,
                            zeroPad: Math.max(
                              0,
                              Math.min(6, parseInt(e.target.value, 10) || 0)
                            ),
                          }))
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {finderRule.mode === "template" && (
                <div className="inspector-field-grid">
                  <div className="field-group full">
                    <label className="field-label" htmlFor="finder-tpl-dir">
                      转换方向
                    </label>
                    <select
                      id="finder-tpl-dir"
                      className="field-input"
                      value={finderRule.templateDirection}
                      onChange={(e) =>
                        setFinderRule((prev) => ({
                          ...prev,
                          templateDirection: e.target.value as
                            | "extract_from_filename"
                            | "rename_from_tags",
                        }))
                      }
                    >
                      <option value="extract_from_filename">
                        从文件名解析提取元数据标签 (%track% - %artist% - %title%)
                      </option>
                      <option value="rename_from_tags">
                        根据现有元数据标签批量重命名文件 ({"{TrackNumber} - {Artist} - {Title}"})
                      </option>
                    </select>
                  </div>
                  {finderRule.templateDirection === "extract_from_filename" ? (
                    <div className="field-group full">
                      <label className="field-label" htmlFor="fn-pattern-input">
                        解析模板（占位符：%track% %disc% %year% %artist% %album_artist% %album% %title%）
                      </label>
                      <input
                        id="fn-pattern-input"
                        type="text"
                        className="field-input mono"
                        value={finderRule.extractPattern}
                        onChange={(e) =>
                          setFinderRule((prev) => ({
                            ...prev,
                            extractPattern: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ) : (
                    <>
                      <div className="field-group full">
                        <label className="field-label" htmlFor="fn-rename-tpl">
                          文件名生成模板（占位符：{"{TrackNumber} {DiscNumber} {Artist} {AlbumArtist} {Album} {Title} {Year} {Format}"}）
                        </label>
                        <input
                          id="fn-rename-tpl"
                          type="text"
                          className="field-input mono"
                          value={finderRule.renamePattern}
                          onChange={(e) =>
                            setFinderRule((prev) => ({
                              ...prev,
                              renamePattern: e.target.value,
                            }))
                          }
                        />
                      </div>
                      <label
                        className="field-group full"
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: "7px",
                          fontSize: "12.5px",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={finderRule.zeroPadTrack}
                          onChange={(e) =>
                            setFinderRule((prev) => ({
                              ...prev,
                              zeroPadTrack: e.target.checked,
                            }))
                          }
                        />
                        <span>音轨号自动补零至两位 (01, 02…)</span>
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>

            <table className="diff-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "36%" }}>
                    当前内容 (修改前)
                  </th>
                  <th scope="col">规则应用预览 (Dry-Run Diff)</th>
                  <th scope="col" style={{ width: "110px" }}>
                    状态
                  </th>
                </tr>
              </thead>
              <tbody>
                {finderChanges.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      style={{
                        color: "var(--text-tertiary)",
                        textAlign: "center",
                        padding: "24px",
                      }}
                    >
                      当前规则无匹配变更，可调整查找内容、作用字段或选中目标音轨。
                    </td>
                  </tr>
                ) : (
                  finderChanges.map((c) => {
                    const orig = trackById.get(c.trackId);
                    const hasCollision = Boolean(
                      c.patch.newFilePath &&
                        finderCollisionPaths.has(c.patch.newFilePath.toLowerCase())
                    );
                    const newFileName = c.patch.newFilePath
                      ? c.patch.newFilePath.split(/[/\\]/).pop()
                      : undefined;
                    const beforeDisplay =
                      finderRule.mode === "template" &&
                      finderRule.templateDirection === "extract_from_filename"
                        ? orig?.fileName
                        : finderRule.targetField === "fileName" ||
                          c.patch.newFilePath
                        ? orig?.fileName
                        : finderRule.targetField === "trackNumber"
                        ? orig?.trackNumber != null
                          ? String(orig.trackNumber)
                          : "（空）"
                        : String(orig?.[finderRule.targetField] || "（空）");

                    return (
                      <tr key={c.trackId}>
                        <td className="mono diff-old">{beforeDisplay}</td>
                        <td className="mono diff-new">
                          {newFileName && <span>{newFileName}</span>}
                          {c.patch.trackNumber !== undefined && (
                            <span>#{String(c.patch.trackNumber).padStart(2, "0")} </span>
                          )}
                          {c.patch.title !== undefined && <span>标题: {c.patch.title} </span>}
                          {c.patch.artist !== undefined && <span>歌手: {c.patch.artist} </span>}
                          {c.patch.albumArtist !== undefined && (
                            <span>专辑歌手: {c.patch.albumArtist} </span>
                          )}
                          {c.patch.album !== undefined && <span>专辑: {c.patch.album} </span>}
                          {c.patch.year !== undefined && <span>年份: {c.patch.year} </span>}
                          {c.patch.genre !== undefined && <span>流派: {c.patch.genre} </span>}
                          {c.patch.comment !== undefined && <span>备注: {c.patch.comment}</span>}
                        </td>
                        <td>
                          {hasCollision ? (
                            <span className="diff-conflict">文件名冲突</span>
                          ) : (
                            <span style={{ color: "var(--staged)" }}>待暂存</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              命中 {finderChanges.length} 首音轨
              {finderCollisionPaths.size > 0
                ? " · 存在重名冲突，请调整序号或规则"
                : ""}
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                取消
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={
                  finderChanges.length === 0 || finderCollisionPaths.size > 0
                }
                onClick={() => {
                  onStageChanges(finderChanges);
                  requestClose();
                }}
              >
                暂存批量更改 ({finderChanges.length})
              </button>
            </div>
          </div>
        </>
      )}

      {/* 4. CJK Cleaner & Pinyin Sort */}
      {modalKind === "cjk" && (
        <>
          <div className="dialog-body scroller">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", fontSize: "12px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={cjkFixMojibake}
                  onChange={(e) => setCjkFixMojibake(e.target.checked)}
                />
                <span>修复乱码标签 (误按 Latin-1 读取的旧编码转 UTF-8)</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label htmlFor="cjk-enc">源编码:</label>
                <select
                  id="cjk-enc"
                  className="field-input"
                  style={{ width: "auto" }}
                  value={cjkEncoding}
                  onChange={(e) =>
                    setCjkEncoding(e.target.value as "gb18030" | "big5" | "shift_jis")
                  }
                >
                  <option value="gb18030">GBK / GB18030 (简体中文)</option>
                  <option value="big5">Big5 (繁体中文)</option>
                  <option value="shift_jis">Shift-JIS (日文)</option>
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="checkbox"
                  checked={cjkNormPunct}
                  onChange={(e) => setCjkNormPunct(e.target.checked)}
                />
                <span>全角括号/空格规范化（如 <code>（Live）</code> → <code> (Live)</code>）</span>
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <label htmlFor="cjk-conv">繁简转换:</label>
                <select
                  id="cjk-conv"
                  className="field-input"
                  style={{ width: "auto" }}
                  value={cjkConvDir}
                  onChange={(e) => setCjkConvDir(e.target.value as "none" | "t2s" | "s2t")}
                >
                  <option value="none">不转换</option>
                  <option value="t2s">繁体中文 → 简体中文</option>
                  <option value="s2t">简体中文 → 繁体中文</option>
                </select>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", gridColumn: "1 / -1" }}>
                <input
                  type="checkbox"
                  checked={cjkGenSort}
                  onChange={(e) => setCjkGenSort(e.target.checked)}
                />
                <span>批量生成并写入标准 <code>ARTISTSORT</code> / <code>ALBUMSORT</code> 拼音排序字段</span>
              </label>
            </div>

            <table className="diff-table">
              <thead>
                <tr>
                  <th scope="col">文件名</th>
                  <th scope="col">变更前</th>
                  <th scope="col">清洗后提案</th>
                </tr>
              </thead>
              <tbody>
                {cjkChanges.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: "center", padding: "18px", color: "var(--text-tertiary)" }}>
                      当前所选曲目无待清洗的 CJK 异常或排序缺失。
                    </td>
                  </tr>
                ) : (
                  cjkChanges.map((c) => {
                    const o = trackById.get(c.trackId);
                    return (
                      <tr key={c.trackId}>
                        <td className="mono">{o?.fileName}</td>
                        <td className="diff-old">
                          {c.patch.title && <div>标题: {o?.title}</div>}
                          {c.patch.artist && <div>歌手: {o?.artist}</div>}
                          {c.patch.album && <div>专辑: {o?.album}</div>}
                          {c.patch.artistSort && <div>ARTISTSORT: {o?.artistSort || "（空）"}</div>}
                        </td>
                        <td className="diff-new">
                          {c.patch.title && <div>标题: {c.patch.title}</div>}
                          {c.patch.artist && <div>歌手: {c.patch.artist}</div>}
                          {c.patch.album && <div>专辑: {c.patch.album}</div>}
                          {c.patch.artistSort && <div>ARTISTSORT: {c.patch.artistSort}</div>}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              共 {cjkChanges.length} 首音轨待应用清洗
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                取消
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={cjkChanges.length === 0}
                onClick={() => {
                  onStageChanges(cjkChanges);
                  requestClose();
                }}
              >
                暂存清洗结果
              </button>
            </div>
          </div>
        </>
      )}

      {/* 5. Online Multi-Source Scraper */}
      {modalKind === "scraper" && (
        <>
          <div className="dialog-body scroller">
            <form
              style={{ display: "flex", gap: "8px" }}
              onSubmit={(e) => {
                e.preventDefault();
                setScraperLoading(true);
                bridgeSearchOnlineReleases(scraperSource, scraperQuery)
                  .then(setScraperResults)
                  .finally(() => setScraperLoading(false));
              }}
            >
              <select
                aria-label="元数据刮削源"
                className="field-input"
                style={{ width: "160px" }}
                value={scraperSource}
                onChange={(e) =>
                  setScraperSource(e.target.value as OnlineSearchResult["source"])
                }
              >
                <option value="itunes">Apple iTunes (高清封面)</option>
                <option value="musicbrainz">MusicBrainz (标准专辑)</option>
                <option value="netease">网易云音乐 (华语/歌词)</option>
                <option value="qqmusic">QQ音乐 (华语/歌词)</option>
              </select>
              <input
                type="search"
                aria-label="专辑或歌手检索词"
                className="field-input"
                value={scraperQuery}
                onChange={(e) => setScraperQuery(e.target.value)}
                placeholder="输入专辑名或歌手名…"
              />
              <button type="submit" className="tool-btn primary-commit">
                {scraperLoading ? "检索中…" : "搜索曲库"}
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {scraperResults.map((res) => (
                <div
                  key={`${res.source}_${res.releaseId}`}
                  style={{
                    display: "flex",
                    gap: "12px",
                    padding: "10px",
                    border: "1px solid var(--border-hairline)",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-elevated)",
                    alignItems: "center",
                  }}
                >
                  {res.coverUrl ? (
                    <img
                      src={res.coverUrl}
                      alt={res.album}
                      width={68}
                      height={68}
                      style={{
                        borderRadius: "4px",
                        border: "1px solid var(--border-hairline)",
                        objectFit: "cover",
                      }}
                    />
                  ) : null}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: "13px" }}>
                      {res.album}{" "}
                      <span className="spec-pill" style={{ marginLeft: "6px" }}>
                        {res.source.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {res.albumArtist} · <span className="mono">{res.year}</span> · {res.genre} · 封面 {res.coverResolution || "高清"}
                    </div>
                    {res.tracks.length > 0 && (
                      <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "4px" }}>
                        匹配曲目: {res.tracks.map((tr) => `${tr.trackNumber}.${tr.title}`).join(" / ")}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="tool-btn primary-commit"
                    onClick={() => {
                      const staged: StagedChange[] = targetTracks.map((t, idx) => {
                        const matched =
                          res.tracks.find((m) => m.trackNumber === t.trackNumber) ??
                          res.tracks[idx];
                        const patch: TagPatch = {
                          album: res.album,
                          albumArtist: res.albumArtist,
                          year: res.year || t.year,
                          genre: res.genre || t.genre,
                          artistSort: toPinyinSortKey(res.albumArtist),
                          albumSort: toPinyinSortKey(res.album),
                        };
                        if (res.coverUrl) {
                          patch.coverDataUrl = res.coverUrl;
                          patch.coverWidth = 1400;
                          patch.coverHeight = 1400;
                          patch.coverBytes = 420000;
                        }
                        if (matched) {
                          patch.title = matched.title;
                          patch.artist = matched.artist;
                          patch.trackNumber = matched.trackNumber;
                          patch.discNumber = matched.discNumber;
                          if (matched.lyrics) patch.lyrics = matched.lyrics;
                        }
                        return {
                          trackId: t.id,
                          patch,
                          reason: `在线刮削 (${res.source}: ${res.album})`,
                        };
                      });
                      onStageChanges(staged);
                      requestClose();
                    }}
                  >
                    应用到所选 ({targetTracks.length})
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              匹配后将自动进入暂存队列预览，确认无误再按 ⌘S 写入。
            </span>
            <button type="button" className="tool-btn" onClick={requestClose}>
              关闭
            </button>
          </div>
        </>
      )}

      {/* 6. Staged Queue & Undo History */}
      {modalKind === "staged_queue" && (
        <>
          <div className="dialog-body scroller">
            <div className="segmented-control" role="group" aria-label="队列与历史视图">
              <button
                type="button"
                className="seg-btn"
                aria-pressed={queueTab === "staged"}
                onClick={() => setQueueTab("staged")}
              >
                待写入暂存队列 ({stagedChanges.length})
              </button>
              <button
                type="button"
                className="seg-btn"
                aria-pressed={queueTab === "history"}
                onClick={() => setQueueTab("history")}
              >
                已提交事务与回滚历史 ({transactions.length})
              </button>
            </div>

            {queueTab === "staged" ? (
              stagedChanges.length === 0 ? (
                <div style={{ padding: "28px", textAlign: "center", color: "var(--text-tertiary)" }}>
                  暂存队列为空。任何编辑或批处理都会先在此排队等待确认。
                </div>
              ) : (
                <table className="diff-table">
                  <thead>
                    <tr>
                      <th scope="col">音轨</th>
                      <th scope="col">变更明细</th>
                      <th scope="col" style={{ width: "76px" }}>
                        操作
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {stagedChanges.map((c) => {
                      const orig = trackById.get(c.trackId);
                      const fields = Object.entries(c.patch)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) =>
                          k === "coverDataUrl"
                            ? "封面图块更新"
                            : k === "newFilePath"
                            ? `移动路径 → ${v}`
                            : `${k} → ${String(v)}`
                        );
                      return (
                        <tr key={c.trackId}>
                          <td>
                            <div style={{ fontWeight: 500 }}>
                              {orig?.title || orig?.fileName}
                            </div>
                            <div style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
                              {c.reason}
                            </div>
                          </td>
                          <td className="mono diff-new">{fields.join(" | ")}</td>
                          <td>
                            <button
                              type="button"
                              className="chip-btn"
                              onClick={() => onUnstageTrack(c.trackId)}
                            >
                              移除
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )
            ) : transactions.length === 0 ? (
              <div style={{ padding: "28px", textAlign: "center", color: "var(--text-tertiary)" }}>
                尚未有提交写入记录。
              </div>
            ) : (
              <table className="diff-table">
                <thead>
                  <tr>
                    <th scope="col">提交时间</th>
                    <th scope="col">事务摘要</th>
                    <th scope="col" style={{ width: "80px" }}>
                      状态
                    </th>
                    <th scope="col" style={{ width: "90px" }}>
                      回滚
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="mono">
                        {new Date(tx.createdAt).toLocaleTimeString()}
                      </td>
                      <td>
                        {tx.summary}（影响 {tx.itemCount} 首）
                      </td>
                      <td>
                        {tx.reverted ? (
                          <span style={{ color: "var(--text-tertiary)" }}>已撤回</span>
                        ) : (
                          <span style={{ color: "var(--status-ok)" }}>已落盘</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="chip-btn"
                          disabled={tx.reverted}
                          onClick={() => onRevertTransaction(tx.id)}
                        >
                          回滚事务
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="dialog-foot">
            <button
              type="button"
              className="tool-btn"
              disabled={stagedChanges.length === 0}
              onClick={onDiscardAllStaged}
            >
              全部放弃暂存
            </button>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                关闭
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={stagedChanges.length === 0}
                onClick={() => {
                  onCommitStaged();
                  requestClose();
                }}
              >
                全部写入硬盘 (⌘S)
              </button>
            </div>
          </div>
        </>
      )}

      {/* 7. FLAC MD5 & Lossless Spec Audit */}
      {modalKind === "md5_audit" && (
        <>
          <div className="dialog-body scroller">
            <p style={{ margin: 0, fontSize: "12.5px", color: "var(--text-secondary)" }}>
              对选中音轨内的 FLAC <code>STREAMINFO</code> 16-byte 音频流 MD5 签名与无损采样参数进行完整性巡检。
            </p>
            <table className="diff-table">
              <thead>
                <tr>
                  <th scope="col">曲目</th>
                  <th scope="col">采样精度</th>
                  <th scope="col">STREAMINFO MD5</th>
                  <th scope="col" style={{ width: "100px" }}>
                    巡检结果
                  </th>
                </tr>
              </thead>
              <tbody>
                {targetTracks.map((t) => (
                  <tr key={t.id}>
                    <td>{t.title || t.fileName}</td>
                    <td className="mono">
                      {t.specs.codec} {t.specs.bitDepth}-bit /{" "}
                      {(t.specs.sampleRate / 1000).toFixed(1)}kHz
                    </td>
                    <td className="mono" style={{ color: "var(--text-tertiary)" }}>
                      {t.specs.streamMd5 || "—"}
                    </td>
                    <td>
                      {t.specs.codec !== "FLAC" ? (
                        <span style={{ color: "var(--text-tertiary)" }}>非 FLAC</span>
                      ) : t.specs.md5Verified === "valid" ? (
                        <span style={{ color: "var(--status-ok)" }}>校验通过</span>
                      ) : t.specs.md5Verified === "mismatch" ? (
                        <span className="diff-conflict">MD5 损坏</span>
                      ) : (
                        <span style={{ color: "var(--staged)" }}>待校验</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-foot">
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              支持 FLAC 原生音频流字节级验证
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="tool-btn" onClick={requestClose}>
                关闭
              </button>
              <button
                type="button"
                className="tool-btn primary-commit"
                disabled={auditing}
                onClick={async () => {
                  setAuditing(true);
                  for (const t of targetTracks) {
                    if (t.specs.codec === "FLAC") {
                      const res = await bridgeVerifyFlacMd5(t);
                      onUpdateTrackMd5Status(t.id, res.status);
                    }
                  }
                  setAuditing(false);
                }}
              >
                <IconShieldCheck size={13} />
                <span>{auditing ? "正在校验音频流…" : "执行全量 MD5 校验"}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
};
