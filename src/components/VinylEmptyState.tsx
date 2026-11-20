import React from "react";
import { IconFolderPlus, IconUpload, IconVinylRecord } from "./Icons";

interface VinylEmptyStateProps {
  hasAnyTracks: boolean;
  onAddDirectory: () => void;
  onTriggerFileImport: () => void;
  onClearFilters?: () => void;
}

export const VinylEmptyState: React.FC<VinylEmptyStateProps> = ({
  hasAnyTracks,
  onAddDirectory,
  onTriggerFileImport,
  onClearFilters,
}) => {
  if (hasAnyTracks) {
    return (
      <div className="vinyl-empty-state">
        <div className="vinyl-empty-hero" aria-hidden="true">
          <div className="empty-sleeve">
            <IconVinylRecord size={36} />
          </div>
          <div className="empty-disc" />
        </div>
        <h3 className="vinyl-empty-title">当前筛选下没有匹配的音轨</h3>
        <p className="vinyl-empty-desc">
          尝试更换搜索关键词、切换目录或清除当前的拼音首字母与诊断筛选条件。
        </p>
        {onClearFilters && (
          <div className="vinyl-empty-actions">
            <button
              type="button"
              className="tool-btn"
              onClick={onClearFilters}
            >
              重置筛选条件
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="vinyl-empty-state">
      <div className="vinyl-empty-hero" aria-hidden="true">
        <div className="empty-sleeve">
          <IconVinylRecord size={38} />
          <span
            className="mono"
            style={{ fontSize: "9.5px", letterSpacing: "0.08em", opacity: 0.7 }}
          >
            HI-RES
          </span>
        </div>
        <div className="empty-disc" />
      </div>
      <h3 className="vinyl-empty-title">你的黑胶唱片架还是空的</h3>
      <p className="vinyl-empty-desc">
        添加本地无损音乐目录以建立持久索引，或直接拖入 <code>.flac</code> /{" "}
        <code>.m4a</code>(ALAC) / <code>.mp3</code> 文件，开始元数据精修与批量重命名整理。
      </p>
      <div className="vinyl-empty-actions">
        <button
          type="button"
          className="tool-btn primary-commit"
          onClick={onAddDirectory}
        >
          <IconFolderPlus size={15} />
          <span>添加自定义音乐目录</span>
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={onTriggerFileImport}
        >
          <IconUpload size={15} />
          <span>导入音频文件</span>
        </button>
      </div>
    </div>
  );
};
