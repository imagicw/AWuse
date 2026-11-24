import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BatchModalKind,
  CenterViewMode,
  LibraryRoot,
  SidebarScope,
  StagedChange,
  TagPatch,
  ThemePreference,
  TrackRecord,
  TransactionRecord,
  WorkspaceMode,
} from "./types/music";
import {
  bridgeCommitChanges,
  bridgeDeleteTracks,
  bridgeListLibraryRoots,
  bridgePickDirectory,
  bridgeQueryTracks,
  bridgeRemoveLibraryRoot,
  bridgeScanDirectory,
  bridgeVerifyFlacMd5,
  computeDiagnosticsFromTracks,
  isTauriEnvironment,
  saveBrowserTracks,
} from "./services/bridge";
import { parseLocalAudioFile } from "./services/binaryAudioParser";
import { detectDiagnosticFlags } from "./services/cjkAndBatchEngine";
import { TopToolbar } from "./components/TopToolbar";
import { LeftSidebar } from "./components/LeftSidebar";
import { AlbumGalleryView } from "./components/AlbumGalleryView";
import { ColumnBrowserView } from "./components/ColumnBrowserView";
import { ProSpreadsheetView } from "./components/ProSpreadsheetView";
import { RightInspector } from "./components/RightInspector";
import { BatchModals } from "./components/BatchModals";
import { MiniTransportBar } from "./components/MiniTransportBar";
import {
  IconClose,
  IconEditRule,
  IconFilter,
  IconFolderTree,
  IconGlobe,
  IconLanguages,
  IconLayers,
  IconShieldCheck,
  IconTrash,
} from "./components/Icons";

const PINYIN_BAR = ["ALL", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), "#"];

function normalizePathPrefix(dirPath: string): string {
  const trimmed = dirPath.trim().replace(/[/\\]+$/, "");
  return trimmed ? `${trimmed}/` : "/";
}

export const App: React.FC = () => {
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("library");
  const [viewMode, setViewMode] = useState<CenterViewMode>("spreadsheet");
  const [scope, setScope] = useState<SidebarScope>("all");
  const [activeRootPath, setActiveRootPath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinyinFilter, setPinyinFilter] = useState<string>("ALL");

  const [libraryTracks, setLibraryTracks] = useState<TrackRecord[]>([]);
  const [stagingTracks, setStagingTracks] = useState<TrackRecord[]>([]);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([]);
  const hydratedRef = useRef(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastClickedIdRef = useRef<string | null>(null);

  const [stagedMap, setStagedMap] = useState<Map<string, StagedChange>>(
    () => new Map()
  );
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [modalKind, setModalKind] = useState<BatchModalKind>(null);

  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const [statusMessage, setStatusMessage] = useState<string>("");
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileImportInputRef = useRef<HTMLInputElement>(null);
  const pinyinPopoverRef = useRef<HTMLDivElement>(null);
  const [pinyinFallbackOpen, setPinyinFallbackOpen] = useState(false);

  // Delete confirmation modal state
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deleteFromDisk, setDeleteFromDisk] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);

  const supportsNativePopover =
    typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;

  const [theme, setTheme] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem("awusic-color-scheme");
      if (saved === "light" || saved === "dark") return saved;
    } catch {}
    return "system";
  });

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
    const t = window.setTimeout(() => setStatusMessage(""), 4200);
    return () => window.clearTimeout(t);
  }, [statusMessage]);

  // Initial hydration from SQLite (Tauri) or localStorage (browser preview), zero sample tracks
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [lib, stg, roots] = await Promise.all([
          bridgeQueryTracks("library"),
          bridgeQueryTracks("staging"),
          bridgeListLibraryRoots(),
        ]);
        if (cancelled) return;
        setLibraryTracks(lib);
        setStagingTracks(stg);
        setLibraryRoots(roots);
      } finally {
        hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist browser-mode tracks cleanly when updated
  useEffect(() => {
    if (!hydratedRef.current || isTauriEnvironment()) return;
    saveBrowserTracks([...libraryTracks, ...stagingTracks]);
  }, [libraryTracks, stagingTracks]);

  // Open / close native <dialog> for delete confirmation
  useEffect(() => {
    const dlg = deleteDialogRef.current;
    if (!dlg) return;
    if (pendingDeleteIds.length > 0) {
      if (!dlg.open) {
        dlg.returnValue = "";
        dlg.showModal();
      }
    } else if (dlg.open) {
      dlg.close();
      dlg.returnValue = "";
    }
  }, [pendingDeleteIds]);

  useEffect(() => {
    const dlg = deleteDialogRef.current;
    if (!dlg) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      setPendingDeleteIds([]);
      setDeleteFromDisk(false);
    };
    const onClose = () => {
      dlg.returnValue = "";
      setPendingDeleteIds([]);
      setDeleteFromDisk(false);
    };
    dlg.addEventListener("cancel", onCancel);
    dlg.addEventListener("close", onClose);
    return () => {
      dlg.removeEventListener("cancel", onCancel);
      dlg.removeEventListener("close", onClose);
    };
  }, []);

  const activeTracks =
    workspaceMode === "library" ? libraryTracks : stagingTracks;
  const setActiveTracks =
    workspaceMode === "library" ? setLibraryTracks : setStagingTracks;

  // Compute live root counts in browser mode while keeping Tauri's counts in sync
  const displayRoots = useMemo<LibraryRoot[]>(() => {
    if (isTauriEnvironment()) return libraryRoots;
    const all = [...libraryTracks, ...stagingTracks];
    return libraryRoots.map((root) => {
      const prefix = normalizePathPrefix(root.path);
      const count = all.filter(
        (t) => t.filePath.startsWith(prefix) || t.filePath === root.path
      ).length;
      return { ...root, trackCount: count };
    });
  }, [libraryRoots, libraryTracks, stagingTracks]);

  const handleChangeScope = (nextScope: SidebarScope) => {
    setScope(nextScope);
    if (nextScope === "albums") setViewMode("gallery");
    else if (nextScope === "artists") setViewMode("columns");
  };

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
    const rootPrefix = activeRootPath ? normalizePathPrefix(activeRootPath) : null;

    return activeTracks.filter((t) => {
      if (
        rootPrefix &&
        !t.filePath.startsWith(rootPrefix) &&
        t.filePath !== activeRootPath
      ) {
        return false;
      }

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
  }, [activeTracks, activeRootPath, scope, pinyinFilter, searchQuery]);

  const selectedTracks = useMemo(
    () => activeTracks.filter((t) => selectedIds.has(t.id)),
    [activeTracks, selectedIds]
  );

  const batchTargetTracks =
    selectedTracks.length > 0 ? selectedTracks : filteredTracks;

  const stagedList = useMemo(
    () => Array.from(stagedMap.values()),
    [stagedMap]
  );

  const stageChanges = useCallback(
    (changes: StagedChange[]) => {
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
    },
    [showStatus]
  );

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
    if (isTauriEnvironment()) {
      const roots = await bridgeListLibraryRoots();
      setLibraryRoots(roots);
    }
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

  const handleRequestDeleteTracks = useCallback((trackIds: string[]) => {
    if (trackIds.length === 0) return;
    setDeleteFromDisk(false);
    setPendingDeleteIds(trackIds);
  }, []);

  const handleConfirmDeleteTracks = async () => {
    if (pendingDeleteIds.length === 0 || deleting) return;
    setDeleting(true);
    try {
      const idSet = new Set(pendingDeleteIds);
      await bridgeDeleteTracks(pendingDeleteIds, deleteFromDisk);

      setLibraryTracks((prev) => prev.filter((t) => !idSet.has(t.id)));
      setStagingTracks((prev) => prev.filter((t) => !idSet.has(t.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pendingDeleteIds) next.delete(id);
        return next;
      });
      setStagedMap((prev) => {
        const next = new Map(prev);
        for (const id of pendingDeleteIds) next.delete(id);
        return next;
      });
      if (playingTrackId && idSet.has(playingTrackId)) {
        setPlayingTrackId(null);
        setIsPlaying(false);
      }

      const roots = await bridgeListLibraryRoots();
      setLibraryRoots(roots);

      const count = pendingDeleteIds.length;
      showStatus(
        deleteFromDisk
          ? `已彻底删除 ${count} 首曲目及本地磁盘文件`
          : `已从曲库列表移除 ${count} 首曲目（保留本地文件）`
      );
      setPendingDeleteIds([]);
      setDeleteFromDisk(false);
    } catch (err) {
      showStatus(`删除失败：${String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  // Global keyboard shortcuts (Cmd+S, Cmd+Z, Delete/Backspace, 1/2/3, Space)
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

      if (inInput || modalKind || pendingDeleteIds.length > 0) return;

      if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
        e.preventDefault();
        handleRequestDeleteTracks(Array.from(selectedIds));
      } else if (e.key === "1") setViewMode("gallery");
      else if (e.key === "2") setViewMode("columns");
      else if (e.key === "3") setViewMode("spreadsheet");
      else if (e.key === " ") {
        e.preventDefault();
        setIsPlaying((p) => !p);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    handleCommitStaged,
    handleRevertTransaction,
    handleRequestDeleteTracks,
    transactions,
    modalKind,
    pendingDeleteIds.length,
    selectedIds,
  ]);

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

  // Parse real local FLAC / ALAC / AAC / MP3 files dropped or picked
  const handleImportFiles = useCallback(
    async (fileList: FileList | File[], fromFolderPicker = false) => {
      const files = Array.from(fileList).filter((f) =>
        /\.(flac|m4a|alac|mp3|wav|ogg)$/i.test(f.name)
      );
      if (files.length === 0) {
        showStatus("未检测到受支持的音频文件 (.flac / .m4a / .mp3 / .wav / .ogg)");
        return;
      }

      let virtualRoot: string | null = null;
      if (fromFolderPicker) {
        const firstRel = (files[0] as File & { webkitRelativePath?: string })
          .webkitRelativePath;
        if (firstRel && firstRel.includes("/")) {
          const topDir = firstRel.split("/")[0];
          virtualRoot = `/${topDir}`;
          await bridgeScanDirectory(virtualRoot, workspaceMode);
        }
      }

      const parsed = await Promise.all(
        files.map(async (f) => {
          const rec = await parseLocalAudioFile(f, workspaceMode);
          const relPath = (f as File & { webkitRelativePath?: string })
            .webkitRelativePath;
          if (relPath && relPath.includes("/")) {
            rec.filePath = `/${relPath}`;
            rec.diagFlags = detectDiagnosticFlags(rec);
          }
          return rec;
        })
      );

      setActiveTracks((prev) => {
        const existingIds = new Set(prev.map((t) => t.id));
        const fresh = parsed.filter((p) => !existingIds.has(p.id));
        return [...fresh, ...prev];
      });
      setSelectedIds(new Set(parsed.map((p) => p.id)));
      const roots = await bridgeListLibraryRoots();
      setLibraryRoots(roots);
      if (virtualRoot) setActiveRootPath(virtualRoot);
      showStatus(`已解析并导入 ${parsed.length} 个本地音频文件`);
    },
    [workspaceMode, setActiveTracks, showStatus]
  );

  const handleScanDirectoryPath = useCallback(
    async (dirPath: string) => {
      const trimmed = dirPath.trim();
      if (!trimmed) return;
      showStatus(`正在扫描目录 ${trimmed}…`);
      const scanned = await bridgeScanDirectory(trimmed, workspaceMode);
      const [refreshedTracks, roots] = await Promise.all([
        bridgeQueryTracks(workspaceMode),
        bridgeListLibraryRoots(),
      ]);
      setLibraryRoots(roots);
      if (isTauriEnvironment()) {
        setActiveTracks(refreshedTracks);
        setActiveRootPath(trimmed);
        showStatus(
          `目录扫描完成：新增/更新 ${scanned?.length ?? 0} 首音轨`
        );
      } else {
        setActiveRootPath(trimmed);
        showStatus(`已添加自定义目录「${trimmed}」，可拖拽该目录内文件导入解析`);
      }
    },
    [workspaceMode, setActiveTracks, showStatus]
  );

  const handleAddDirectoryRequest = useCallback(async () => {
    if (isTauriEnvironment()) {
      try {
        const picked = await bridgePickDirectory();
        if (picked) {
          await handleScanDirectoryPath(picked);
        }
      } catch (err) {
        showStatus(`打开目录选择器失败：${String(err)}`);
      }
    } else {
      folderInputRef.current?.click();
    }
  }, [handleScanDirectoryPath, showStatus]);

  const handleRemoveRoot = useCallback(
    async (dirPath: string) => {
      await bridgeRemoveLibraryRoot(dirPath);
      const prefix = normalizePathPrefix(dirPath);
      setLibraryTracks((prev) =>
        prev.filter((t) => !t.filePath.startsWith(prefix) && t.filePath !== dirPath)
      );
      setStagingTracks((prev) =>
        prev.filter((t) => !t.filePath.startsWith(prefix) && t.filePath !== dirPath)
      );
      if (activeRootPath === dirPath) {
        setActiveRootPath(null);
      }
      const roots = await bridgeListLibraryRoots();
      setLibraryRoots(roots);
      showStatus(`已移除目录「${dirPath}」及其索引记录`);
    },
    [activeRootPath, showStatus]
  );

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

  const activeRootObj = displayRoots.find((r) => r.path === activeRootPath);
  const currentHeaderTitle = activeRootObj
    ? `目录：${activeRootObj.label}`
    : scopeTitles[scope];

  const handleClearFilters = () => {
    setScope("all");
    setActiveRootPath(null);
    setSearchQuery("");
    setPinyinFilter("ALL");
  };

  const closePinyinPopover = () => {
    if (supportsNativePopover) {
      (
        pinyinPopoverRef.current as
          | (HTMLDivElement & { hidePopover?: () => void })
          | null
      )?.hidePopover?.();
    } else {
      setPinyinFallbackOpen(false);
    }
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
          libraryRoots={displayRoots}
          activeRootPath={activeRootPath}
          onSelectRootPath={setActiveRootPath}
          onAddDirectoryRequest={handleAddDirectoryRequest}
          onAddDirectoryByPath={handleScanDirectoryPath}
          onRescanRoot={handleScanDirectoryPath}
          onRemoveRoot={handleRemoveRoot}
          onImportFiles={(files) => handleImportFiles(files, false)}
        />

        <main
          className="center-canvas"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
              e.preventDefault();
              handleImportFiles(e.dataTransfer.files, false);
            }
          }}
        >
          <div className="canvas-subbar">
            <div className="subbar-meta">
              <h2 className="subbar-title">{currentHeaderTitle}</h2>
              <span className="subbar-stats tabular-nums">
                {filteredTracks.length} / {activeTracks.length} 首
                {selectedIds.size > 0 ? ` · 已选 ${selectedIds.size} 首` : ""}
              </span>
            </div>

            <div className="batch-action-strip">
              <button
                type="button"
                className={`chip-btn ${pinyinFilter !== "ALL" ? "active" : ""}`}
                {...(supportsNativePopover
                  ? { popoverTarget: "pinyin-filter-popover" }
                  : { onClick: () => setPinyinFallbackOpen((v) => !v) })}
              >
                <IconFilter size={12} />
                <span>
                  {pinyinFilter === "ALL" ? "拼音筛选" : `拼音: ${pinyinFilter}`}
                </span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("filename")}
              >
                <IconEditRule size={12} />
                <span>Finder 批量规则</span>
              </button>
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
                <span>专辑归并</span>
              </button>
              <button
                type="button"
                className="chip-btn"
                onClick={() => setModalKind("cjk")}
              >
                <IconLanguages size={12} />
                <span>CJK清洗</span>
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
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="chip-btn danger"
                  onClick={() =>
                    handleRequestDeleteTracks(Array.from(selectedIds))
                  }
                >
                  <IconTrash size={12} />
                  <span>删除 ({selectedIds.size})</span>
                </button>
              )}
            </div>
          </div>

          {/* On-demand Popover for A-Z Pinyin Quick Filter */}
          <div
            ref={pinyinPopoverRef}
            id="pinyin-filter-popover"
            {...(supportsNativePopover ? { popover: "auto" } : {})}
            className="pinyin-popover"
            style={
              !supportsNativePopover
                ? { display: pinyinFallbackOpen ? "flex" : "none" }
                : undefined
            }
            aria-label="拼音首字母 A-Z 快速索引"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                按歌手拼音首字母筛选
              </span>
              <div style={{ display: "flex", gap: "6px" }}>
                {pinyinFilter !== "ALL" && (
                  <button
                    type="button"
                    className="chip-btn"
                    onClick={() => {
                      setPinyinFilter("ALL");
                      closePinyinPopover();
                    }}
                  >
                    显示全部
                  </button>
                )}
                <button
                  type="button"
                  className="icon-micro-btn"
                  aria-label="关闭拼音筛选"
                  onClick={closePinyinPopover}
                >
                  <IconClose size={13} />
                </button>
              </div>
            </div>
            <div className="pinyin-jump-rail" role="toolbar" aria-label="拼音字母索引">
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
                    onClick={() => {
                      setPinyinFilter(letter);
                      closePinyinPopover();
                    }}
                  >
                    {letter === "ALL" ? "全部" : letter}
                  </button>
                );
              })}
            </div>
          </div>

          {viewMode === "gallery" ? (
            <AlbumGalleryView
              tracks={filteredTracks}
              hasAnyTracks={activeTracks.length > 0}
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
              onRequestDeleteTracks={handleRequestDeleteTracks}
              onAddDirectory={handleAddDirectoryRequest}
              onTriggerFileImport={() => fileImportInputRef.current?.click()}
              onClearFilters={handleClearFilters}
            />
          ) : viewMode === "columns" ? (
            <ColumnBrowserView
              tracks={filteredTracks}
              hasAnyTracks={activeTracks.length > 0}
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
              onRequestDeleteTracks={handleRequestDeleteTracks}
              onAddDirectory={handleAddDirectoryRequest}
              onTriggerFileImport={() => fileImportInputRef.current?.click()}
              onClearFilters={handleClearFilters}
            />
          ) : (
            <ProSpreadsheetView
              tracks={filteredTracks}
              hasAnyTracks={activeTracks.length > 0}
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
              onRequestDeleteTracks={handleRequestDeleteTracks}
              onAddDirectory={handleAddDirectoryRequest}
              onTriggerFileImport={() => fileImportInputRef.current?.click()}
              onClearFilters={handleClearFilters}
            />
          )}

          {statusMessage && (
            <div
              role="status"
              aria-live="polite"
              style={{
                position: "absolute",
                right: "18px",
                bottom: "16px",
                padding: "8px 14px",
                fontSize: "12.5px",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-strong)",
                color: "var(--text-primary)",
                boxShadow: "0 10px 26px rgba(0, 0, 0, 0.22)",
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
          onRequestDeleteTracks={handleRequestDeleteTracks}
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

      {/* Native <dialog> Confirmation for Deleting Tracks */}
      <dialog
        ref={deleteDialogRef}
        className="ada-dialog confirm-dialog"
        aria-labelledby="delete-dialog-title"
      >
        <div className="dialog-head">
          <h2 id="delete-dialog-title">
            确认删除 {pendingDeleteIds.length} 首曲目
          </h2>
          <button
            type="button"
            className="tool-btn icon-only"
            aria-label="关闭窗口"
            onClick={() => {
              setPendingDeleteIds([]);
              setDeleteFromDisk(false);
            }}
          >
            <IconClose size={14} />
          </button>
        </div>
        <div className="dialog-body">
          <p style={{ margin: 0, fontSize: "13px", color: "var(--text-secondary)" }}>
            请选择如何处理选中的 {pendingDeleteIds.length} 首音频曲目：
          </p>
          <div className="delete-choice-list" role="radiogroup" aria-label="删除方式">
            <label
              className={`delete-choice-card ${!deleteFromDisk ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="delete-mode"
                checked={!deleteFromDisk}
                onChange={() => setDeleteFromDisk(false)}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px" }}>
                  仅从曲库列表移除（推荐）
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  仅清理软件索引与视图展示，本地硬盘上的原始音频文件将完好保留。
                </div>
              </div>
            </label>
            <label
              className={`delete-choice-card danger ${deleteFromDisk ? "selected" : ""}`}
            >
              <input
                type="radio"
                name="delete-mode"
                checked={deleteFromDisk}
                onChange={() => setDeleteFromDisk(true)}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--status-danger)" }}>
                  同时删除本地磁盘原文件
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                  从曲库移除的同时直接删除本地磁盘中的音频文件，此操作不可撤销。
                </div>
              </div>
            </label>
          </div>
        </div>
        <div className="dialog-foot">
          <span style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>
            {deleteFromDisk ? "将永久删除本地文件" : "原文件保持安全"}
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              className="tool-btn"
              autoFocus
              disabled={deleting}
              onClick={() => {
                setPendingDeleteIds([]);
                setDeleteFromDisk(false);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className={deleteFromDisk ? "tool-btn danger-btn" : "tool-btn primary-commit"}
              disabled={deleting}
              onClick={handleConfirmDeleteTracks}
            >
              {deleting
                ? "处理中…"
                : deleteFromDisk
                ? "确认删除文件"
                : "确认从列表移除"}
            </button>
          </div>
        </div>
      </dialog>

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
            handleImportFiles(e.target.files, true);
            e.target.value = "";
          }
        }}
      />

      {/* Hidden file picker for empty state file import */}
      <input
        ref={fileImportInputRef}
        type="file"
        multiple
        accept=".flac,.m4a,.mp3,.wav,.ogg,audio/*"
        className="visually-hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            handleImportFiles(e.target.files, false);
            e.target.value = "";
          }
        }}
      />
    </div>
  );
};

export default App;
