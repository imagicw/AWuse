import React, { useEffect, useRef, useState } from "react";
import { StagedChange, TagPatch, TrackRecord } from "../types/music";
import { toPinyinSortKey } from "../services/cjkAndBatchEngine";
import { closeTopLayer } from "./BatchModals";
import {
  IconClose,
  IconDisc,
  IconGlobe,
  IconShieldCheck,
  IconUpload,
} from "./Icons";

interface TrackInspectorDialogProps {
  open: boolean;
  selectedTracks: TrackRecord[];
  stagedMap: Map<string, StagedChange>;
  trackNav: {
    hasPrev: boolean;
    hasNext: boolean;
    position: string;
    go: (dir: -1 | 1) => void;
  } | null;
  onStageBatchPatch: (trackIds: string[], patch: TagPatch, reason: string) => void;
  onVerifyTrackMd5: (track: TrackRecord) => void;
  onOpenScraper: () => void;
  onClose: () => void;
}

const MIXED_SENTINEL = "\u0000__MIXED__";

function resolveField(
  tracks: TrackRecord[],
  stagedMap: Map<string, StagedChange>,
  getter: (t: TrackRecord, p?: TagPatch) => string
): { value: string; mixed: boolean; staged: boolean } {
  if (tracks.length === 0) return { value: "", mixed: false, staged: false };
  let anyStaged = false;
  const vals = tracks.map((t) => {
    const p = stagedMap.get(t.id)?.patch;
    if (p) {
      const base = getter(t, undefined);
      const patched = getter(t, p);
      if (base !== patched) anyStaged = true;
      return patched;
    }
    return getter(t, undefined);
  });
  const first = vals[0];
  const mixed = vals.some((v) => v !== first);
  return {
    value: mixed ? MIXED_SENTINEL : first,
    mixed,
    staged: anyStaged,
  };
}

// Field with local draft state: commits to the staged queue only on blur/Enter,
// Escape restores the original value — avoids per-keystroke staging churn.
const InspectorField: React.FC<{
  id: string;
  label: string;
  state: { value: string; mixed: boolean; staged: boolean };
  onCommit: (val: string) => void;
  mono?: boolean;
  full?: boolean;
  placeholder?: string;
}> = ({ id, label, state, onCommit, mono, full, placeholder }) => {
  const display = state.mixed ? "" : state.value;
  const [val, setVal] = useState(display);
  const [editing, setEditing] = useState(false);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (!editing) setVal(display);
  }, [display, editing]);

  return (
    <div className={`field-group ${full ? "full" : ""}`}>
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
        {state.staged ? <span className="field-staged-tag">已修改</span> : null}
      </label>
      <input
        id={id}
        type="text"
        className={`field-input ${state.staged ? "staged" : ""} ${mono ? "mono" : ""}`}
        value={val}
        placeholder={state.mixed ? "<多个值 — 输入批量覆写>" : placeholder ?? ""}
        onChange={(e) => setVal(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          setEditing(false);
          if (skipCommitRef.current) {
            skipCommitRef.current = false;
            return;
          }
          if (val !== display) onCommit(val);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            skipCommitRef.current = true;
            setVal(display);
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
};

// Same draft-commit model as InspectorField, for multi-line values.
const InspectorTextarea: React.FC<{
  id: string;
  state: { value: string; mixed: boolean; staged: boolean };
  onCommit: (val: string) => void;
  mixedPlaceholder: string;
  placeholder: string;
}> = ({ id, state, onCommit, mixedPlaceholder, placeholder }) => {
  const display = state.mixed ? "" : state.value;
  const [val, setVal] = useState(display);
  const [editing, setEditing] = useState(false);
  const skipCommitRef = useRef(false);

  useEffect(() => {
    if (!editing) setVal(display);
  }, [display, editing]);

  return (
    <textarea
      id={id}
      className={`field-textarea ${state.staged ? "staged" : ""}`}
      value={val}
      placeholder={state.mixed ? mixedPlaceholder : placeholder}
      onChange={(e) => setVal(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        if (skipCommitRef.current) {
          skipCommitRef.current = false;
          return;
        }
        if (val !== display) onCommit(val);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          skipCommitRef.current = true;
          setVal(display);
          e.currentTarget.blur();
        }
      }}
    />
  );
};

async function resizeImageToDataUrl(file: File, maxDim = 1200): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const bytes = Math.round((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
    return { dataUrl, width, height, bytes };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const TrackInspectorDialog: React.FC<TrackInspectorDialogProps> = ({
  open,
  selectedTracks,
  stagedMap,
  trackNav,
  onStageBatchPatch,
  onVerifyTrackMd5,
  onOpenScraper,
  onClose,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open) {
      if (!dlg.open) {
        dlg.returnValue = "";
        dlg.showModal();
      }
    } else if (dlg.open) {
      closeTopLayer(dlg);
    }
  }, [open]);

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

  const ids = selectedTracks.map((t) => t.id);
  const single = selectedTracks.length === 1 ? selectedTracks[0] : null;
  const firstTrack = selectedTracks[0];
  const firstPatch = firstTrack ? stagedMap.get(firstTrack.id)?.patch : undefined;

  const titleState = resolveField(selectedTracks, stagedMap, (t, p) => p?.title ?? t.title);
  const artistState = resolveField(selectedTracks, stagedMap, (t, p) => p?.artist ?? t.artist);
  const aaState = resolveField(selectedTracks, stagedMap, (t, p) => p?.albumArtist ?? t.albumArtist);
  const albumState = resolveField(selectedTracks, stagedMap, (t, p) => p?.album ?? t.album);
  const yearState = resolveField(selectedTracks, stagedMap, (t, p) => p?.year ?? t.year);
  const genreState = resolveField(selectedTracks, stagedMap, (t, p) => p?.genre ?? t.genre);
  const trackNumState = resolveField(selectedTracks, stagedMap, (t, p) => {
    const v = p?.trackNumber !== undefined ? p.trackNumber : t.trackNumber;
    return v != null ? String(v) : "";
  });
  const totalTracksState = resolveField(selectedTracks, stagedMap, (t, p) => {
    const v = p?.totalTracks !== undefined ? p.totalTracks : t.totalTracks;
    return v != null ? String(v) : "";
  });
  const discState = resolveField(selectedTracks, stagedMap, (t, p) => {
    const v = p?.discNumber !== undefined ? p.discNumber : t.discNumber;
    return v != null ? String(v) : "";
  });
  const artistSortState = resolveField(selectedTracks, stagedMap, (t, p) => p?.artistSort ?? t.artistSort);
  const albumSortState = resolveField(selectedTracks, stagedMap, (t, p) => p?.albumSort ?? t.albumSort);
  const commentState = resolveField(selectedTracks, stagedMap, (t, p) => p?.comment ?? t.comment);
  const lyricsState = resolveField(selectedTracks, stagedMap, (t, p) => p?.lyrics ?? t.lyrics);

  const previewCover = firstTrack
    ? firstPatch?.coverDataUrl !== undefined
      ? firstPatch.coverDataUrl
      : selectedTracks.find((t) => t.coverDataUrl)?.coverDataUrl ?? null
    : null;

  const handleCoverUpload = async (file: File) => {
    const resized = await resizeImageToDataUrl(file, 1200);
    onStageBatchPatch(
      ids,
      {
        coverDataUrl: resized.dataUrl,
        coverWidth: resized.width,
        coverHeight: resized.height,
        coverBytes: resized.bytes,
      },
      `嵌入并优化封面 (${resized.width}×${resized.height})`
    );
  };

  const handleExportLrc = () => {
    if (!single) return;
    const text = firstPatch?.lyrics ?? single.lyrics;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = single.fileName.replace(/\.[^.]+$/, ".lrc");
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleAutoPinyin = () => {
    const aa = aaState.mixed ? "" : aaState.value || (artistState.mixed ? "" : artistState.value);
    const alb = albumState.mixed ? "" : albumState.value;
    if (single) {
      onStageBatchPatch(
        [single.id],
        {
          artistSort: toPinyinSortKey(single.albumArtist || single.artist),
          albumSort: toPinyinSortKey(single.album),
        },
        "生成拼音排序标签"
      );
    } else if (aa || alb) {
      const patch: TagPatch = {};
      if (aa) patch.artistSort = toPinyinSortKey(aa);
      if (alb) patch.albumSort = toPinyinSortKey(alb);
      onStageBatchPatch(ids, patch, "批量生成拼音排序标签");
    }
  };

  const renderInput = (
    id: string,
    label: string,
    state: { value: string; mixed: boolean; staged: boolean },
    onCommit: (val: string) => void,
    opts?: { mono?: boolean; full?: boolean; placeholder?: string }
  ) => (
    <InspectorField
      key={`${id}-${ids.join(",")}`}
      id={id}
      label={label}
      state={state}
      onCommit={onCommit}
      mono={opts?.mono}
      full={opts?.full}
      placeholder={opts?.placeholder}
    />
  );

  return (
    <dialog
      ref={dialogRef}
      className="ada-dialog inspector-dialog"
      aria-labelledby="inspector-dialog-title"
    >
      <div className="dialog-head">
        <h2 id="inspector-dialog-title">
          {selectedTracks.length === 1
            ? "音轨属性"
            : `批量编辑 (${selectedTracks.length} 首)`}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {firstTrack && (
            <span className="spec-pill">
              {firstTrack.specs.codec}{" "}
              {firstTrack.specs.bitDepth}/
              {(firstTrack.specs.sampleRate / 1000).toFixed(
                firstTrack.specs.sampleRate % 1000 === 0 ? 0 : 1
              )}
              k
            </span>
          )}
          <button
            type="button"
            className="tool-btn icon-only"
            aria-label="关闭属性检查器"
            onClick={requestClose}
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>

      <div className="dialog-body scroller inspector-dialog-body">
        {selectedTracks.length === 0 ? (
          <div
            style={{
              padding: "48px 16px",
              textAlign: "center",
              color: "var(--text-tertiary)",
              fontSize: "12.5px",
            }}
          >
            在中央列表点选或框选音轨，即可查看音频流规格与批量修改标签。
          </div>
        ) : (
          <>
            {/* Cover Art Block */}
            <div className="inspector-cover-row">
              <div className="inspector-cover-box">
                {previewCover ? (
                  <img src={previewCover} alt="当前专辑封面" width={104} height={104} />
                ) : (
                  <div className="cover-missing-placeholder">
                    <IconDisc size={22} />
                    <span>无封面</span>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "11.5px", color: "var(--text-secondary)" }}>
                  {firstTrack.coverWidth > 0 ? (
                    <span className="mono">
                      {firstTrack.coverWidth}×{firstTrack.coverHeight} ·{" "}
                      {(firstTrack.coverBytes / 1024).toFixed(0)} KB
                    </span>
                  ) : (
                    <span>未内嵌封面图块</span>
                  )}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => coverInputRef.current?.click()}
                  >
                    <IconUpload size={11} />
                    <span>替换并优化</span>
                  </button>
                  <button type="button" className="chip-btn" onClick={onOpenScraper}>
                    <IconGlobe size={11} />
                    <span>在线找高清图</span>
                  </button>
                </div>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="visually-hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleCoverUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>

            <hr className="inspector-section-divider" />

            {/* Core Metadata Grid */}
            <div className="inspector-field-grid">
              {renderInput(
                "insp-title",
                "标题 (Title)",
                titleState,
                (val) => onStageBatchPatch(ids, { title: val }, "修改标题"),
                { full: true }
              )}
              {renderInput(
                "insp-artist",
                "歌手 (Artist)",
                artistState,
                (val) => onStageBatchPatch(ids, { artist: val }, "修改歌手"),
                { full: true }
              )}
              {renderInput(
                "insp-aa",
                "专辑歌手 (Album Artist)",
                aaState,
                (val) => onStageBatchPatch(ids, { albumArtist: val }, "修改专辑歌手"),
                { full: true }
              )}
              {renderInput(
                "insp-album",
                "专辑 (Album)",
                albumState,
                (val) => onStageBatchPatch(ids, { album: val }, "修改专辑"),
                { full: true }
              )}
              {renderInput(
                "insp-year",
                "年份",
                yearState,
                (val) => onStageBatchPatch(ids, { year: val }, "修改年份"),
                { mono: true }
              )}
              {renderInput(
                "insp-genre",
                "流派 (Genre)",
                genreState,
                (val) => onStageBatchPatch(ids, { genre: val }, "修改流派")
              )}
              {renderInput(
                "insp-track",
                "音轨号",
                trackNumState,
                (val) =>
                  onStageBatchPatch(
                    ids,
                    { trackNumber: val.trim() ? parseInt(val, 10) || null : null },
                    "修改音轨号"
                  ),
                { mono: true }
              )}
              {renderInput(
                "insp-total-tracks",
                "总音轨数",
                totalTracksState,
                (val) =>
                  onStageBatchPatch(
                    ids,
                    { totalTracks: val.trim() ? parseInt(val, 10) || null : null },
                    "修改总音轨数"
                  ),
                { mono: true }
              )}
              {renderInput(
                "insp-disc",
                "碟号 (Disc)",
                discState,
                (val) =>
                  onStageBatchPatch(
                    ids,
                    { discNumber: val.trim() ? parseInt(val, 10) || null : null },
                    "修改碟号"
                  ),
                { mono: true }
              )}
              {renderInput(
                "insp-comment",
                "备注 (Comment)",
                commentState,
                (val) => onStageBatchPatch(ids, { comment: val }, "修改备注")
              )}
            </div>

            <hr className="inspector-section-divider" />

            {/* Sort Tags */}
            <div className="inspector-field-grid">
              <div className="field-group full" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <span className="field-label">拼音排序索引 (Sort Tags)</span>
                <button type="button" className="chip-btn" onClick={handleAutoPinyin}>
                  填充拼音排序
                </button>
              </div>
              {renderInput(
                "insp-asort",
                "ARTISTSORT",
                artistSortState,
                (val) => onStageBatchPatch(ids, { artistSort: val }, "修改 ARTISTSORT"),
                { mono: true }
              )}
              {renderInput(
                "insp-albsort",
                "ALBUMSORT",
                albumSortState,
                (val) => onStageBatchPatch(ids, { albumSort: val }, "修改 ALBUMSORT"),
                { mono: true }
              )}
            </div>

            <hr className="inspector-section-divider" />

            {/* Synced Lyrics */}
            <div className="field-group full">
              <div className="field-label">
                <label htmlFor="insp-lyrics">内嵌 / 同步歌词 (.lrc)</label>
                {single && (lyricsState.value || single.lyrics) ? (
                  <button type="button" className="chip-btn" onClick={handleExportLrc}>
                    导出同名 .lrc
                  </button>
                ) : null}
              </div>
              <InspectorTextarea
                key={`lyrics-${ids.join(",")}`}
                id="insp-lyrics"
                state={lyricsState}
                mixedPlaceholder="<多首音轨歌词内容不同>"
                placeholder="[00:00.00] 粘贴 LRC 时间轴歌词或纯文本歌词…"
                onCommit={(val) =>
                  onStageBatchPatch(ids, { lyrics: val }, "更新内嵌歌词")
                }
              />
            </div>

            {/* Audio Stream & FLAC MD5 Diagnostics */}
            {single && (
              <>
                <hr className="inspector-section-divider" />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span className="field-label">无损音频流与完整性</span>
                  {single.specs.codec === "FLAC" && (
                    <button
                      type="button"
                      className="chip-btn"
                      disabled={verifying}
                      onClick={async () => {
                        setVerifying(true);
                        await onVerifyTrackMd5(single);
                        setVerifying(false);
                      }}
                    >
                      <IconShieldCheck size={12} />
                      <span>{verifying ? "校验中…" : "验证 FLAC MD5"}</span>
                    </button>
                  )}
                </div>
                <dl className="spec-kv-list" style={{ margin: 0 }}>
                  <dt className="spec-k">编码格式</dt>
                  <dd className="spec-v" style={{ margin: 0 }}>
                    {single.specs.codec} ({single.specs.channels}ch)
                  </dd>
                  <dt className="spec-k">采样精度</dt>
                  <dd className="spec-v" style={{ margin: 0 }}>
                    {single.specs.bitDepth}-bit / {(single.specs.sampleRate / 1000).toFixed(1)} kHz
                  </dd>
                  <dt className="spec-k">文件体积</dt>
                  <dd className="spec-v" style={{ margin: 0 }}>
                    {(single.fileSize / (1024 * 1024)).toFixed(2)} MB ({single.specs.bitrateKbps} kbps)
                  </dd>
                  <dt className="spec-k">流 MD5</dt>
                  <dd
                    className="spec-v"
                    style={{
                      margin: 0,
                      color:
                        single.specs.md5Verified === "valid"
                          ? "var(--status-ok)"
                          : single.specs.md5Verified === "mismatch"
                          ? "var(--status-danger)"
                          : "var(--text-secondary)",
                    }}
                    title={single.specs.streamMd5 || "无"}
                  >
                    {single.specs.codec !== "FLAC"
                      ? "非 FLAC 容器"
                      : single.specs.md5Verified === "valid"
                      ? `通过 (${single.specs.streamMd5.slice(0, 10)}…)`
                      : single.specs.md5Verified === "mismatch"
                      ? "校验不匹配!"
                      : single.specs.streamMd5
                      ? `待检 (${single.specs.streamMd5.slice(0, 10)}…)`
                      : "未记录 MD5"}
                  </dd>
                  <dt className="spec-k">文件路径</dt>
                  <dd className="spec-v" style={{ margin: 0 }} title={single.filePath}>
                    {single.filePath}
                  </dd>
                </dl>
              </>
            )}
          </>
        )}
      </div>

      {selectedTracks.length > 0 && (
        <div className="dialog-foot">
          {trackNav ? (
            <div className="inspector-nav">
              <button
                type="button"
                className="chip-btn"
                disabled={!trackNav.hasPrev}
                onClick={() => trackNav.go(-1)}
              >
                ‹ 上一首
              </button>
              <span className="inspector-nav-pos mono tabular-nums">
                {trackNav.position}
              </span>
              <button
                type="button"
                className="chip-btn"
                disabled={!trackNav.hasNext}
                onClick={() => trackNav.go(1)}
              >
                下一首 ›
              </button>
            </div>
          ) : (
            <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
              编辑在失焦时自动暂存 · ⌘S 写入落盘
            </span>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {trackNav && (
              <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
                ⌘S 写入落盘
              </span>
            )}
            <button type="button" className="tool-btn" onClick={requestClose}>
              关闭
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
};
