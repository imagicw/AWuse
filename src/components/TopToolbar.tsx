import React, { useRef, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  BatchModalKind,
  CenterViewMode,
  ThemePreference,
  WorkspaceMode,
} from "../types/music";
import { isTauriEnvironment } from "../services/bridge";
import {
  IconAWuseLogo,
  IconColumns,
  IconGrid,
  IconInbox,
  IconLibrary,
  IconSave,
  IconSearch,
  IconSunMoon,
  IconTable,
  IconUndo,
} from "./Icons";

interface TopToolbarProps {
  workspaceMode: WorkspaceMode;
  onChangeWorkspaceMode: (mode: WorkspaceMode) => void;
  viewMode: CenterViewMode;
  onChangeViewMode: (view: CenterViewMode) => void;
  searchQuery: string;
  onChangeSearchQuery: (q: string) => void;
  stagedCount: number;
  transactionCount: number;
  onCommitStaged: () => void;
  onOpenModal: (kind: BatchModalKind) => void;
  theme: ThemePreference;
  onCycleTheme: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  workspaceMode,
  onChangeWorkspaceMode,
  viewMode,
  onChangeViewMode,
  searchQuery,
  onChangeSearchQuery,
  stagedCount,
  transactionCount,
  onCommitStaged,
  onOpenModal,
  theme,
  onCycleTheme,
}) => {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const themeLabel =
    theme === "system" ? "跟随系统" : theme === "dark" ? "暗黑模式" : "浅色模式";

  const handleToolbarMouseDown = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (
      target?.closest(
        "button, input, select, textarea, a, label, .segmented-control, .search-box, .no-drag"
      )
    ) {
      return;
    }
    if (!isTauriEnvironment()) return;
    if (e.detail === 2) {
      getCurrentWindow().toggleMaximize().catch(() => {});
    } else {
      getCurrentWindow().startDragging().catch(() => {});
    }
  };

  return (
    <header
      className="top-toolbar"
      data-tauri-drag-region
      onMouseDown={handleToolbarMouseDown}
    >
      <div className="toolbar-left" data-tauri-drag-region>
        <div
          className="macos-traffic-spacer"
          data-tauri-drag-region
          aria-hidden="true"
        />
        <h1 className="brand-mark" data-tauri-drag-region>
          <IconAWuseLogo size={16} />
          <span data-tauri-drag-region>AWuse</span>
        </h1>

        <div
          className="segmented-control no-drag"
          role="group"
          aria-label="工作区模式切换"
        >
          <button
            type="button"
            className="seg-btn"
            aria-pressed={workspaceMode === "library"}
            onClick={() => onChangeWorkspaceMode("library")}
          >
            <IconLibrary size={13} />
            <span>媒体库</span>
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={workspaceMode === "staging"}
            onClick={() => onChangeWorkspaceMode("staging")}
          >
            <IconInbox size={13} />
            <span>临时工作区</span>
          </button>
        </div>
      </div>

      <div className="toolbar-center" data-tauri-drag-region>
        <search className="search-box no-drag">
          <IconSearch size={13} />
          <label htmlFor="global-track-search" className="visually-hidden">
            全文检索曲库标签、歌手、专辑或文件路径
          </label>
          <input
            ref={searchRef}
            id="global-track-search"
            type="search"
            className="search-input"
            placeholder="搜索歌名、歌手、专辑、采样率或路径…"
            value={searchQuery}
            onChange={(e) => onChangeSearchQuery(e.target.value)}
          />
          <span className="kbd-hint">⌘F</span>
        </search>
      </div>

      <div className="toolbar-right" data-tauri-drag-region>
        <div
          className="segmented-control"
          role="group"
          aria-label="主视图切换"
        >
          <button
            type="button"
            className="seg-btn"
            aria-pressed={viewMode === "gallery"}
            onClick={() => onChangeViewMode("gallery")}
          >
            <IconGrid size={13} />
            <span>画廊</span>
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={viewMode === "columns"}
            onClick={() => onChangeViewMode("columns")}
          >
            <IconColumns size={13} />
            <span>分栏</span>
          </button>
          <button
            type="button"
            className="seg-btn"
            aria-pressed={viewMode === "spreadsheet"}
            onClick={() => onChangeViewMode("spreadsheet")}
          >
            <IconTable size={13} />
            <span>表格</span>
          </button>
        </div>

        <button
          type="button"
          className="tool-btn"
          onClick={() => onOpenModal("staged_queue")}
          aria-label={`暂存事务队列与历史撤销（${stagedCount} 项待提交，${transactionCount} 笔历史记录）`}
        >
          <IconUndo size={13} />
          <span className="tabular-nums">历史 ({transactionCount})</span>
        </button>

        {stagedCount > 0 ? (
          <>
            <button
              type="button"
              className="tool-btn staged-pill"
              onClick={() => onOpenModal("staged_queue")}
            >
              <span className="tabular-nums">待写预览: {stagedCount}</span>
            </button>
            <button
              type="button"
              className="tool-btn primary-commit"
              onClick={onCommitStaged}
            >
              <IconSave size={13} />
              <span className="tabular-nums">写入落盘 ⌘S</span>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="tool-btn"
            aria-disabled="true"
            onClick={(e) => e.preventDefault()}
          >
            <IconSave size={13} />
            <span>无待写变更</span>
          </button>
        )}

        <button
          type="button"
          className="tool-btn"
          onClick={onCycleTheme}
          aria-label={`外观主题：${themeLabel}，点击切换`}
        >
          <IconSunMoon size={13} />
          <span>{themeLabel}</span>
        </button>
      </div>
    </header>
  );
};
