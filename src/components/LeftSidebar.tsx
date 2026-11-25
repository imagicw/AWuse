import React from "react";
import {
  DiagnosticSummary,
  LibraryRoot,
  SidebarScope,
} from "../types/music";
import {
  IconAlert,
  IconDisc,
  IconFolder,
  IconFolderPlus,
  IconFolderTree,
  IconLibrary,
  IconRefresh,
  IconShieldCheck,
  IconTrash,
} from "./Icons";

interface LeftSidebarProps {
  scope: SidebarScope;
  onChangeScope: (scope: SidebarScope) => void;
  diagnostics: DiagnosticSummary;
  artistCount: number;
  albumCount: number;
  libraryRoots: LibraryRoot[];
  activeRootPath: string | null;
  onSelectRootPath: (path: string | null) => void;
  onAddDirectoryRequest: () => void;
  onRescanRoot: (dirPath: string) => void;
  onRemoveRoot: (dirPath: string) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  scope,
  onChangeScope,
  diagnostics,
  artistCount,
  albumCount,
  libraryRoots,
  activeRootPath,
  onSelectRootPath,
  onAddDirectoryRequest,
  onRescanRoot,
  onRemoveRoot,
}) => {
  return (
    <aside className="left-sidebar scroller" aria-label="媒体库导航与目录管理">
      <div>
        <h2 className="sidebar-section-title">媒体库浏览</h2>
        <nav aria-label="曲库维度">
          <ul className="nav-list">
            <li>
              <button
                type="button"
                className="nav-item-btn"
                aria-current={scope === "all" && !activeRootPath ? "page" : undefined}
                onClick={() => {
                  onSelectRootPath(null);
                  onChangeScope("all");
                }}
              >
                <span className="nav-item-left">
                  <IconLibrary size={15} />
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
                  <IconDisc size={15} />
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
                  <IconDisc size={15} />
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
                  <IconFolderTree size={15} />
                  <span className="nav-item-label">文件夹路径视图</span>
                </span>
              </button>
            </li>
          </ul>
        </nav>
      </div>

      {/* Custom Directories Section */}
      <div>
        <div className="sidebar-section-header">
          <h2 className="sidebar-section-title">自定义音乐目录</h2>
          <button
            type="button"
            className="sidebar-add-btn"
            onClick={onAddDirectoryRequest}
            title="浏览并添加本地音乐目录"
          >
            <IconFolderPlus size={12} />
            <span>添加</span>
          </button>
        </div>

        {libraryRoots.length === 0 ? (
          <div className="dir-empty-hint">
            暂无已添加目录，点击右上角「添加」挂载本地无损音乐文件夹。
          </div>
        ) : (
          <ul className="dir-root-list" aria-label="已挂载目录列表">
            {libraryRoots.map((root) => {
              const isSelected = activeRootPath === root.path;
              return (
                <li
                  key={root.path}
                  className={`dir-root-item ${isSelected ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="dir-root-main"
                    title={root.path}
                    aria-pressed={isSelected}
                    onClick={() =>
                      onSelectRootPath(isSelected ? null : root.path)
                    }
                  >
                    <span className="nav-item-left">
                      <IconFolder size={14} />
                      <span className="nav-item-label">{root.label}</span>
                    </span>
                    <span className="nav-count tabular-nums">{root.trackCount}</span>
                  </button>
                  <div className="dir-root-actions">
                    <button
                      type="button"
                      className="icon-micro-btn"
                      title={`重新扫描 ${root.label}`}
                      aria-label={`重新扫描目录 ${root.label}`}
                      onClick={() => onRescanRoot(root.path)}
                    >
                      <IconRefresh size={12} />
                    </button>
                    <button
                      type="button"
                      className="icon-micro-btn danger"
                      title={`移除目录 ${root.label}`}
                      aria-label={`移除目录 ${root.label}`}
                      onClick={() => onRemoveRoot(root.path)}
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Library Diagnostics */}
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.missingCover > 0 ? "warn" : ""
                  }`}
                >
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.fragmentedAlbum > 0 ? "warn" : ""
                  }`}
                >
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.encodingOrCjkIssue > 0 ? "warn" : ""
                  }`}
                >
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.missingTrackOrYear > 0 ? "warn" : ""
                  }`}
                >
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.unorganizedPath > 0 ? "warn" : ""
                  }`}
                >
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
                <span
                  className={`nav-count tabular-nums ${
                    diagnostics.md5Failed > 0 ? "danger" : ""
                  }`}
                >
                  {diagnostics.md5Failed}
                </span>
              </button>
            </li>
          </ul>
        </nav>
      </div>

    </aside>
  );
};
