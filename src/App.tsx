import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BatchModalKind,
  CenterViewMode,
  SidebarScope,
  StagedChange,
  TagPatch,
  ThemePreference,
  TrackRecord,
  TransactionRecord,
  WorkspaceMode,
} from "./types/music";
import {
  createInitialLibraryTracks,
  createInitialStagingTracks,
} from "./services/sampleLibrary";
import {
  bridgeCommitChanges,
  bridgeScanDirectory,
  bridgeVerifyFlacMd5,
  computeDiagnosticsFromTracks,
  isTauriEnvironment,
} from "./services/bridge";
import { parseLocalAudioFile } from "./services/binaryAudioParser";
import { TopToolbar } from "./components/TopToolbar";
import { LeftSidebar } from "./components/LeftSidebar";
import { AlbumGalleryView } from "./components/AlbumGalleryView";
import { ColumnBrowserView } from "./components/ColumnBrowserView";
import { ProSpreadsheetView } from "./components/ProSpreadsheetView";
import { RightInspector } from "./components/RightInspector";
import { BatchModals } from "./components/BatchModals";
import { MiniTransportBar } from "./components/MiniTransportBar";
import {
  IconCodeTag,
  IconFolderTree,
  IconGlobe,
  IconLanguages,
  IconLayers,
  IconShieldCheck,
} from "./components/Icons";

const PINYIN_BAR = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];

export const App: React.FC = () => {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("library");
  const [viewMode, setViewMode] = useState<CenterViewMode>("spreadsheet");
  const [scope, setScope] = useState<SidebarScope>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [pinyinFilter, setPinyinFilter] = useState<string>("ALL");

  const [libraryTracks, setLibraryTracks] = useState<TrackRecord[]>(() =>
    createInitialLibraryTracks()
  );
  const [stagingTracks, setStagingTracks] = useState<TrackRecord[]>(() =>
    createInitialStagingTracks()
  );

  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(["lib_jay_04"])
  );
  const lastClickedIdRef = useRef<string | null>("lib_jay_04");

  const [stagedMap, setStagedMap] = useState<Map<string, StagedChange>>(
    () => new Map()
  );
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [modalKind, setModalKind] = useState<BatchModalKind>(null);

  const [playingTrackId, setPlayingTrackId] = useState<string | null>(
    "lib_jay_01"
  );
  const [isPlaying, setIsPlaying] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string>("");
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [theme, setTheme] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem("awusic-color-scheme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "system";
  });

  // Sync theme override to <meta name="color-scheme"> and storage per dark-mode-toggle guidance
  useEffect(() => {
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) {
      meta.setAttribute("content", theme === "system" ? "light dark" : theme);
    }
    try {
      if (theme === "system") {
        localStorage.removeItem("awusic-color-scheme");
      } else {
        localStorage.setItem("awusic-color-scheme", theme);
      }
    } catch {}
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme((prev) =>
      prev === "system" ? "dark" : prev === "dark" ? "light" : "system"
    );
  }, []);

  const showStatus = useCallback((msg: string) => {
    setStatusMessage(msg);
  }, []);

  useEffect(() => {
    if (!statusMessage) return;
    const t = window.setTimeout(() => setStatusMessage(""), 4000);
    return () => window.clearTimeout(t);
  }, [statusMessage]);

  const activeTracks =
    workspaceMode === "library" ? libraryTracks : stagingTracks;
  const setActiveTracks =
    workspaceMode === "library" ? setLibraryTracks : setStagingTracks;

  // Switch default view gracefully when toggling scope
  const handleChangeScope = (nextScope: SidebarScope) => {
    setScope(nextScope);
    if (nextScope === "albums") setViewMode("gallery");
    else if (nextScope === "artists") setViewMode("columns");
  };

  // Diagnostics & aggregate counts
  const diagnostics = useMemo(
    () => computeDiagnosticsFromTracks(activeTracks),
    [activeTracks]
  );

  const artistCount = useMemo(() => {
    const s = new Set(
      activeTracks.map((t) => (t.albumArtist || t.artist || "未知").trim())
    );
    return s.size;
  }, [activeTracks]);

  const albumCount = useMemo(() => {
    const s = new Set(
      activeTracks.map(
        (t) =>
          `${(t.albumArtist || t.artist || "").trim()}::${t.album.trim()}`
      )
    );
    return s.size;
  }, [activeTracks]);

  const availableInitials = useMemo(() => {
    const s = new Set<string>();
    for (const t of activeTracks) s.add(t.pinyinInitial);
    return s;
  }, [activeTracks]);

  const filteredTracks = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeTracks.filter((t) => {
      if (scope === "diag_missing_cover" && !t.diagFlags.includes("missing_cover"))
        return false;
      if (
        scope === "diag_fragmented_album" &&
        !t.diagFlags.includes("fragmented_album")
      )
        return false;
      if (scope === "diag_encoding_issue" && !t.diagFlags.includes("encoding_issue"))
        return false;
      if (
        scope === "diag_missing_track_or_year" &&
        !t.diagFlags.includes("missing_track_or_year")
      )
        return false;
      if (
        scope === "diag_unorganized_path" &&
        !t.diagFlags.includes("unorganized_path")
      )
        return false;
      if (scope === "diag_md5_mismatch" && !t.diagFlags.includes("md5_mismatch"))
        return false;

      if (pinyinFilter !== "ALL" && t.pinyinInitial !== pinyinFilter) {
        return false;
      }

      if (q) {
        const hay = `${t.title} ${t.artist} ${t.albumArtist} ${t.album} ${t.genre} ${t.year} ${t.specs.codec} ${t.filePath}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activeTracks, scope, pinyinFilter, searchQuery]);

  const selectedTracks = useMemo(
    () => activeTracks.filter((t) => selectedIds.has(t.id)),
    [activeTracks, selectedIds]
  );

  // Batch target defaults to selected tracks if any, otherwise all visible filtered tracks
  const batchTargetTracks =
    selectedTracks.length > 0 ? selectedTracks : filteredTracks;

  const stagedList = useMemo(
    () => Array.from(stagedMap.values()),
    [stagedMap]
  );

  const stageChanges = useCallback((changes: StagedChange[]) => {
    if (changes.length === 0) return;
    setStagedMap((prev) => {
      const next = new Map(prev);
      for (const c of changes) {
        const existing = next.get(c.trackId);
        if (existing) {
          next.set(c.trackId, {
            trackId: c.trackId,
            patch: { ...existing.patch, ...c.patch },
            reason: c.reason,
          });
        } else {
          next.set(c.trackId, c);
        }
      }
      return next;
    });
    showStatus(`已暂存 ${changes.length} 项变更预览（按 ⌘S 写入落盘）`);
  }, [showStatus]);

  const handleStageFieldEdit = useCallback(
    (trackId: string, patch: TagPatch, reason: string) => {
      stageChanges([{ trackId, patch, reason }]);
    },
    [stageChanges]
  );

  const handleStageBatchPatch = useCallback(
    (trackIds: string[], patch: TagPatch, reason: string) => {
      stageChanges(trackIds.map((trackId) => ({ trackId, patch, reason })));
    },
    [stageChanges]
  );

  const handleCommitStaged = useCallback(async () => {
    if (stagedMap.size === 0) return;
    const changes = Array.from(stagedMap.values());
    const summary =
      changes.length === 1
        ? changes[0].reason
        : `批量提交 ${changes.length} 首音轨变更`;
    const { updatedTracks, transaction } = await bridgeCommitChanges(
      activeTracks,
      changes,
      summary,
      true,
      true
    );
    setActiveTracks(updatedTracks);
    setStagedMap(new Map());
    setTransactions((prev) => [transaction, ...prev]);
    showStatus(`已原子写入 ${transaction.itemCount} 首音轨变更并记录回滚快照`);
  }, [stagedMap, activeTracks, setActiveTracks, showStatus]);

  const handleRevertTransaction = useCallback(
    (txId: string) => {
      const targetTx = transactions.find((t) => t.id === txId);
      if (!targetTx || targetTx.reverted) return;

      const restoreById = new Map<string, TrackRecord>();
      for (const item of targetTx.items) {
        try {
          restoreById.set(item.trackId, JSON.parse(item.beforeJson) as TrackRecord);
        } catch {}
      }

      setLibraryTracks((prev) => prev.map((t) => restoreById.get(t.id) ?? t));
      setStagingTracks((prev) => prev.map((t) => restoreById.get(t.id) ?? t));
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === txId ? { ...tx, reverted: true } : tx))
      );
      showStatus(`已回滚事务「${targetTx.summary}」`);
    },
    [transactions, showStatus]
  );

  // Global keyboard shortcuts (Cmd+S, Cmd+Z, 1/2/3, Space)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleCommitStaged();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !inInput) {
        const latest = transactions.find((tx) => !tx.reverted);
        if (latest) {
          e.preventDefault();
          handleRevertTransaction(latest.id);
        }
        return;
      }

      if (inInput || modalKind) return;

      if (e.key === "1") setViewMode("gallery");
      else if (e.key === "2") setViewMode("columns");
      else if (e.key === "3") setViewMode("spreadsheet");
      else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCommitStaged, handleRevertTransaction, transactions, modalKind]);

  const handleSelectTrack = useCallback(
    (trackId: string, opts: { multi?: boolean; range?: boolean }) => {
      setSelectedIds((prev) => {
        if (opts.range && lastClickedIdRef.current) {
          const i1 = filteredTracks.findIndex(
            (t) => t.id === lastClickedIdRef.current
          );
          const i2 = filteredTracks.findIndex((t) => t.id === trackId);
          if (i1 >= 0 && i2 >= 0) {
            const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
            const next = new Set(opts.multi ? prev : []);
            for (let i = lo; i <= hi; i++) next.add(filteredTracks[i].id);
            return next;
          }
        }
        if (opts.multi) {
          const next = new Set(prev);
          if (next.has(trackId)) next.delete(trackId);
          else next.add(trackId);
          lastClickedIdRef.current = trackId;
          return next;
        }
        lastClickedIdRef.current = trackId;
        return new Set([trackId]);
      });
    },
    [filteredTracks]
  );

  // Parse real local FLAC / ALAC / AAC files dropped or picked
  const handleImportFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).filter((f) =>
        /\.(flac|m4a|alac|mp3|wav|ogg)$/i.test(f.name)
      );
      if (files.length === 0) {
        showStatus("未检测到受支持的音频文件 (.flac / .m4a / .mp3 / .wav / .ogg)");
        return;
      }
      const parsed = await Promise.all(
        files.map((f) => parseLocalAudioFile(f, workspaceMode))
      );
      setActiveTracks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const fresh = parsed.filter((p) => !existingIds.has(p.id));
        return [...fresh, ...prev];
      });
      setSelectedIds(new Set(parsed.map((p) => p.id)));
      showStatus(`已解析并导入 ${parsed.length} 个本地无损/音频文件`);
    },
    [workspaceMode, setActiveTracks, showStatus]
  );

  const handleScanFolderRequest = async () => {
    if (isTauriEnvironment()) {
      const res = await bridgeScanDirectory("/Users/imagic/Music", workspaceMode);
      if (res) {
        setActiveTracks(res);
        showStatus(`已完成本地目录扫描，索引 ${res.length} 首音频`);
      }
    } else {
      folderInputRef.current?.click();
    }
  };

  const handleVerifySingleMd5 = async (track: TrackRecord) => {
    const res = await bridgeVerifyFlacMd5(track);
    setActiveTracks((prev) =>
      prev.map((t) =>
        t.id === track.id
          ? {
              ...t,
              specs: {
                ...t.specs,
                streamMd5: res.computed || t.specs.streamMd5,
                md5Verified: res.status,
              },
              diagFlags:
                res.status === "valid"
                  ? t.diagFlags.filter((f) => f !== "md5_mismatch")
                  : t.diagFlags,
            }
          : t
      )
    );
    showStatus(
      res.status === "valid"
        ? `MD5 校验通过：${track.title}`
        : `MD5 校验失败：${track.title}`
    );
  };

  const playingTrack = useMemo(
    () =>
      libraryTracks.find((t) => t.id === playingTrackId) ||
      stagingTracks.find((t) => t.id === playingTrackId) ||
      selectedTracks[0] ||
      null,
    [libraryTracks, stagingTracks, playingTrackId, selectedTracks]
  );

  const scopeTitles: Record<SidebarScope, string> = {
    all: workspaceMode === "library" ? "全部媒体库音轨" : "临时工作区待整理音轨",
    artists: "按歌手聚合视图",
    albums: "专辑画廊浏览",
    folders: "目录路径结构",
    diag_missing_cover: "诊断筛选：缺失封面",
    diag_fragmented_album: "诊断筛选：散碎专辑 / Feat. 歌手未归一",
    diag_encoding_issue: "诊断筛选：GBK 乱码 / 全半角标点异常",
    diag_missing_track_or_year: "诊断筛选：缺失音轨号或年份",
    diag_unorganized_path: "诊断筛选：未归档目录路径",
    diag_md5_mismatch: "诊断筛选：FLAC MD5 校验异常",
  };

  return (
    <div className="workbench-shell">
      <TopToolbar
        workspaceMode={workspaceMode}
        onChangeWorkspaceMode={(m) => {
          setWorkspaceMode(m);
          setSelectedIds(new Set());
          setScope("all");
          setPinyinFilter("ALL");
        }}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        searchQuery={searchQuery}
        onChangeSearchQuery={setSearchQuery}
        stagedCount={stagedMap.size}
        transactionCount={transactions.length}
        onCommitStaged={handleCommitStaged}
        onOpenModal={setModalKind}
        theme={theme}
        onCycleTheme={cycleTheme}
      />

      <div className="workbench-body">
        <LeftSidebar
          workspaceMode={workspaceMode}
          scope={scope}
          onChangeScope={handleChangeScope}
          diagnostics={diagnostics}
          artistCount={artistCount}
          albumCount={albumCount}
          onImportFiles={handleImportFiles}
          onScanFolderRequest={handleScanFolderRequest}
        />

        <main
          className="center-canvas"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              handleImportFiles(e.dataTransfer.files);
            }
          }}
        >
          <div className="canvas-subbar">
            <div className="subbar-meta">
              <h2 className="subbar-title">{scopeTitles[scope]}</h2>
              <span className="subbar-stats tabular-nums">
                显示 {filteredTracks.length} / {activeTracks.length} 首
                {selectedIds.size > 0 ? ` · 已选 ${selectedIds.size} 首` : ""}
              </span>
            </div>

            <div className="batch-action-strip">
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("reorganize")}
              >
                <IconFolderTree size={12} />
                <span>目录重整</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("unify")}
              >
                <IconLayers size={12} />
                <span>散碎专辑归并</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("filename")}
              >
                <IconCodeTag size={12} />
                <span>文件名/正则</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("cjk")}
              >
                <IconLanguages size={12} />
                <span>CJK清洗 & 拼音</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("scraper")}
              >
                <IconGlobe size={12} />
                <span>在线刮削</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("md5_audit")}
              >
                <IconShieldCheck size={12} />
                <span>MD5 巡检</span>
              </button>
            </div>
          </div>

          {/* A-Z Pinyin Quick Jump Rail */}
          <div className="pinyin-jump-rail" role="toolbar" aria-label="拼音首字母 A-Z 索引跳转条">
            {PINYIN_BAR.map((letter) => {
              const enabled =
                letter === "ALL" || availableInitials.has(letter);
              return (
                <button
                  key={letter}
                  type="button"
                  className="pinyin-letter-btn"
                  disabled={!enabled}
                  aria-pressed={pinyinFilter === letter}
                  onClick={() => setPinyinFilter(letter)}
                >
                  {letter === "ALL" ? "全部" : letter}
                </button>
              );
            })}
          </div>

          {viewMode === "gallery" ? (
            <AlbumGalleryView
              tracks={filteredTracks}
              stagedMap={stagedMap}
              onSelectTrackIds={(ids) => setSelectedIds(new Set(ids))}
              onPlayTrack={(t) => {
                setPlayingTrackId(t.id);
                setIsPlaying(true);
              }}
              onQuickUnifyAlbum={() => setModalKind("unify")}
              onOpenScraperForAlbum={(albTracks) => {
                setSelectedIds(new Set(albTracks.map((t) => t.id)));
                setModalKind("scraper");
              }}
            />
          ) : viewMode === "columns" ? (
            <ColumnBrowserView
              tracks={filteredTracks}
              selectedIds={selectedIds}
              stagedMap={stagedMap}
              playingTrackId={playingTrackId}
              onSelectTrack={handleSelectTrack}
              onSelectAll={(ids) => setSelectedIds(new Set(ids))}
              onStageFieldEdit={handleStageFieldEdit}
              onPlayTrack={(t) => {
                setPlayingTrackId(t.id);
                setIsPlaying(true);
              }}
            />
          ) : (
            <ProSpreadsheetView
              tracks={filteredTracks}
              selectedIds={selectedIds}
              stagedMap={stagedMap}
              playingTrackId={playingTrackId}
              onSelectTrack={handleSelectTrack}
              onSelectAll={(ids) => setSelectedIds(new Set(ids))}
              onStageFieldEdit={handleStageFieldEdit}
              onPlayTrack={(t) => {
                setPlayingTrackId(t.id);
                setIsPlaying(true);
              }}
            />
          )}

          {/* Polite Live Region for Non-Intrusive Feedback */}
          {statusMessage && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                right: "14px",
                bottom: "12px",
                padding: "6px 11px",
                fontSize: "12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
                boxShadow: "0 6px 18px rgba(0, 0, 0, 0.22)",
                zIndex: 10,
              }}
            >
              {statusMessage}
            </div>
          )}
        </main>

        <RightInspector
          selectedTracks={selectedTracks}
          stagedMap={stagedMap}
          onStageBatchPatch={handleStageBatchPatch}
          onVerifyTrackMd5={handleVerifySingleMd5}
          onOpenScraper={() => setModalKind("scraper")}
        />
      </div>

      <MiniTransportBar
        track={playingTrack}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying((p) => !p)}
      />

      <BatchModals
        modalKind={modalKind}
        onClose={() => setModalKind(null)}
        targetTracks={batchTargetTracks}
        allTracks={activeTracks}
        stagedChanges={stagedList}
        transactions={transactions}
        onStageChanges={stageChanges}
        onUnstageTrack={(trackId) =>
          setStagedMap((prev) => {
            const next = new Map(prev);
            next.delete(trackId);
            return next;
          })
        }
        onDiscardAllStaged={() => {
          setStagedMap(new Map());
          showStatus("已清空所有暂存变更");
        }}
        onCommitStaged={handleCommitStaged}
        onRevertTransaction={handleRevertTransaction}
        onUpdateTrackMd5Status={(trackId, status) =>
          setActiveTracks((prev) =>
            prev.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    specs: { ...t.specs, md5Verified: status },
                    diagFlags:
                      status === "valid"
                        ? t.diagFlags.filter((f) => f !== "md5_mismatch")
                        : t.diagFlags,
                  }
                : t
            )
          )
        }
      />

      {/* Hidden directory picker for browser preview mode */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is standard in Chromium/WebKit desktop browsers
        webkitdirectory=""
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleImportFiles(e.target.files);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
};

export default App;
