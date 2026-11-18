import React, { useRef, useState } from "react";
import { DiagnosticSummary, SidebarScope, WorkspaceMode } from "../types/music";
import {
  IconAlert,
  IconDisc,
  IconFolderTree,
  IconLibrary,
  IconShieldCheck,
  IconUpload,
} from "./Icons";

interface LeftSidebarProps {
  workspaceMode: WorkspaceMode;
  scope: SidebarScope;
  onChangeScope: (scope: SidebarScope) => void;
  diagnostics: DiagnosticSummary;
  artistCount: number;
  albumCount: number;
  onImportFiles: (files: FileList | File[]) => void;
  onScanFolderRequest: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  workspaceMode,
  scope,
  onChangeScope,
  diagnostics,
  artistCount,
  albumCount,
  onImportFiles,
  onScanFolderRequest,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  return (
    <aside className="left-sidebar scroller" aria-label="媒体库导航与智能诊断">
      <div>
        <h2 className="sidebar-section-title">
          {workspaceMode === "library" ? "媒体库浏览" : "临时待整理区"}
        </h2>
        <nav aria-label="曲库维度">
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "all" ? "page" : undefined}
                onClick={() => onChangeScope("all")}
              >
                <span className="nav-item-left">
                  <IconLibrary size={14} />
                  <span className="nav-item-label">全部音轨</span>
                </span>
                <span className="nav-count tabular-nums">{diagnostics.totalTracks}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "artists" ? "page" : undefined}
                onClick={() => onChangeScope("artists")}
              >
                <span className="nav-item-left">
                  <IconDisc size={14} />
                  <span className="nav-item-label">按歌手聚合</span>
                </span>
                <span className="nav-count tabular-nums">{artistCount}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "albums" ? "page" : undefined}
                onClick={() => onChangeScope("albums")}
              >
                <span className="nav-item-left">
                  <IconDisc size={14} />
                  <span className="nav-item-label">按专辑聚合</span>
                </span>
                <span className="nav-count tabular-nums">{albumCount}</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "folders" ? "page" : undefined}
                onClick={() => onChangeScope("folders")}
              >
                <span className="nav-item-left">
                  <IconFolderTree size={14} />
                  <span className="nav-item-label">文件夹路径视图</span>
                </span>
              </button>
            </li>
          </ul>
        </nav>
      </div>

      <div>
        <h2 className="sidebar-section-title">曲库体检诊断</h2>
        <nav aria-label="智能诊断筛选">
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_missing_cover" ? "page" : undefined}
                onClick={() => onChangeScope("diag_missing_cover")}
              >
                <span className="nav-item-left">
                  <IconAlert size={14} />
                  <span className="nav-item-label">缺失封面</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.missingCover > 0 ? "warn" : ""}`}>
                  {diagnostics.missingCover}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_fragmented_album" ? "page" : undefined}
                onClick={() => onChangeScope("diag_fragmented_album")}
              >
                <span className="nav-item-left">
                  <IconAlert size={14} />
                  <span className="nav-item-label">散碎专辑 / Feat.</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.fragmentedAlbum > 0 ? "warn" : ""}`}>
                  {diagnostics.fragmentedAlbum}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_encoding_issue" ? "page" : undefined}
                onClick={() => onChangeScope("diag_encoding_issue")}
              >
                <span className="nav-item-left">
                  <IconAlert size={14} />
                  <span className="nav-item-label">乱码 / 标点异常</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.encodingOrCjkIssue > 0 ? "warn" : ""}`}>
                  {diagnostics.encodingOrCjkIssue}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_missing_track_or_year" ? "page" : undefined}
                onClick={() => onChangeScope("diag_missing_track_or_year")}
              >
                <span className="nav-item-left">
                  <IconAlert size={14} />
                  <span className="nav-item-label">缺失曲目号 / 年份</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.missingTrackOrYear > 0 ? "warn" : ""}`}>
                  {diagnostics.missingTrackOrYear}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_unorganized_path" ? "page" : undefined}
                onClick={() => onChangeScope("diag_unorganized_path")}
              >
                <span className="nav-item-left">
                  <IconFolderTree size={14} />
                  <span className="nav-item-label">待归档目录</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.unorganizedPath > 0 ? "warn" : ""}`}>
                  {diagnostics.unorganizedPath}
                </span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "diag_md5_mismatch" ? "page" : undefined}
                onClick={() => onChangeScope("diag_md5_mismatch")}
              >
                <span className="nav-item-left">
                  <IconShieldCheck size={14} />
                  <span className="nav-item-label">MD5 校验异常</span>
                </span>
                <span className={`nav-count tabular-nums ${diagnostics.md5Failed > 0 ? "danger" : ""}`}>
                  {diagnostics.md5Failed}
                </span>
              </button>
            </li>
          </ul>
        </nav>
      </div>

      <div
        className={`drop-zone-box ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <div className="drop-zone-title">
          <IconUpload size={14} />
          <span>导入真实音频解析</span>
        </div>
        <div className="drop-zone-sub">
          拖入本地 <code>.flac</code> / <code>.m4a</code>(ALAC/AAC) 文件直接解析二进制流标签与封面，或扫描本地文件夹。
        </div>
        <div style={{ display: "flex", gap: "6px", marginTop: "2px" }}>
          <button
            type="button"
            className="chip-btn"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => fileInputRef.current?.click()}
          >
            选择文件
          </button>
          <button
            type="button"
            className="chip-btn"
            style={{ flex: 1, justifyContent: "center" }}
            onClick={onScanFolderRequest}
          >
            挂载目录
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".flac,.m4a,.mp3,.wav,.ogg,audio/*"
          className="visually-hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              onImportFiles(e.target.files);
              e.target.value = "";
            }
          }}
        />
      </div>
    </aside>
  );
};
