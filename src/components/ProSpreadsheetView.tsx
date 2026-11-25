import React, { useState, useRef } from "react";
import { StagedChange, TagPatch, TrackRecord } from "../types/music";
import {
  describeDiagFlags,
  describeDiagFlagsShort,
} from "../services/cjkAndBatchEngine";
import { IconDisc, IconPlay, IconSliders, IconTrash } from "./Icons";
import { VinylEmptyState } from "./VinylEmptyState";

interface ProSpreadsheetViewProps {
  tracks: TrackRecord[];
  hasAnyTracks: boolean;
  selectedIds: Set<string>;
  stagedMap: Map<string, StagedChange>;
  playingTrackId: string | null;
  onSelectTrack: (trackId: string, opts: { multi?: boolean; range?: boolean }) => void;
  onSelectAll: (ids: string[]) => void;
  onStageFieldEdit: (trackId: string, patch: TagPatch, reason: string) => void;
  onPlayTrack: (track: TrackRecord) => void;
  onInspectTrack: (track: TrackRecord) => void;
  onRequestDeleteTracks: (trackIds: string[]) => void;
  onAddDirectory: () => void;
  onTriggerFileImport: () => void;
  onClearFilters: () => void;
}

type EditableField =
  | "trackNumber"
  | "title"
  | "artist"
  | "album"
  | "year";

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatRate(sr: number, bd: number): string {
  const khz = (sr / 1000).toFixed(sr % 1000 === 0 ? 0 : 1);
  return `${bd}/${khz}k`;
}

export const ProSpreadsheetView: React.FC<ProSpreadsheetViewProps> = ({
  tracks,
  hasAnyTracks,
  selectedIds,
  stagedMap,
  playingTrackId,
  onSelectTrack,
  onSelectAll,
  onStageFieldEdit,
  onPlayTrack,
  onInspectTrack,
  onRequestDeleteTracks,
  onAddDirectory,
  onTriggerFileImport,
  onClearFilters,
}) => {
  const [editingCell, setEditingCell] = useState<{
    trackId: string;
    field: EditableField;
    value: string;
  } | null>(null);
  const tableRegionRef = useRef<HTMLDivElement>(null);

  const commitCellEdit = () => {
    if (!editingCell) return;
    const { trackId, field, value } = editingCell;
    const track = tracks.find((t) => t.id === trackId);
    if (!track) {
      setEditingCell(null);
      return;
    }

    const patch: TagPatch = {};
    if (field === "trackNumber") {
      const n = value.trim() === "" ? null : parseInt(value, 10);
      if (n === null || Number.isFinite(n)) {
        if (n !== track.trackNumber) {
          patch.trackNumber = n;
        }
      }
    } else if (track[field] !== value) {
      patch[field] = value;
    }

    if (Object.keys(patch).length > 0) {
      onStageFieldEdit(trackId, patch, `行内编辑 ${field}`);
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell) return;
    if (tracks.length === 0) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault();
      onSelectAll(tracks.map((t) => t.id));
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
      e.preventDefault();
      onRequestDeleteTracks(Array.from(selectedIds));
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const firstSelected = tracks.findIndex((t) => selectedIds.has(t.id));
      const nextIdx =
        e.key === "ArrowDown"
          ? Math.min(tracks.length - 1, firstSelected < 0 ? 0 : firstSelected + 1)
          : Math.max(0, firstSelected <= 0 ? 0 : firstSelected - 1);
      onSelectTrack(tracks[nextIdx].id, { range: e.shiftKey });
    } else if (e.key === "Enter" && selectedIds.size === 1) {
      const target = tracks.find((t) => selectedIds.has(t.id));
      if (target) {
        e.preventDefault();
        setEditingCell({
          trackId: target.id,
          field: "title",
          value: target.title,
        });
      }
    }
  };

  const renderCell = (
    t: TrackRecord,
    field: EditableField,
    displayVal: string,
    isStaged: boolean,
    extraClass = "",
    thumbUrl?: string | null
  ) => {
    const isEditing = editingCell?.trackId === t.id && editingCell?.field === field;
    if (isEditing) {
      return (
        <td className={`${extraClass} ${isStaged ? "cell-staged" : ""}`}>
          <input
            type="text"
            className="cell-inline-input"
            aria-label={`编辑 ${field}`}
            autoFocus
            value={editingCell.value}
            onChange={(e) =>
              setEditingCell({ ...editingCell, value: e.target.value })
            }
            onBlur={commitCellEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitCellEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setEditingCell(null);
              }
            }}
          />
        </td>
      );
    }

    return (
      <td
        className={`${extraClass} ${isStaged ? "cell-staged" : ""}`}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditingCell({
            trackId: t.id,
            field,
            value:
              field === "trackNumber"
                ? t.trackNumber != null
                  ? String(t.trackNumber)
                  : ""
                : String(t[field] ?? ""),
          });
        }}
        title={`${displayVal || "（空）"} — 双击行内编辑`}
      >
        {field === "title" ? (
          <div className="track-title-cell">
            <div className="track-row-thumb" aria-hidden="true">
              {thumbUrl ? (
                <img src={thumbUrl} alt="" loading="lazy" width={34} height={34} />
              ) : (
                <IconDisc size={15} />
              )}
            </div>
            <span className="track-row-text">
              {displayVal || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
            </span>
          </div>
        ) : (
          displayVal || <span style={{ color: "var(--text-tertiary)" }}>—</span>
        )}
      </td>
    );
  };

  if (tracks.length === 0) {
    return (
      <VinylEmptyState
        hasAnyTracks={hasAnyTracks}
        onAddDirectory={onAddDirectory}
        onTriggerFileImport={onTriggerFileImport}
        onClearFilters={onClearFilters}
      />
    );
  }

  const allSelected =
    tracks.length > 0 && tracks.every((t) => selectedIds.has(t.id));

  return (
    <div
      ref={tableRegionRef}
      tabIndex={0}
      role="region"
      aria-label="无损音频元数据批处理表格"
      className="table-wrapper scroller"
      onKeyDown={handleKeyDown}
    >
      <table className="pro-table">
        <caption className="visually-hidden">
          音轨元数据表格，双击单元格可编辑并暂存变更
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: "44px", textAlign: "center" }}>
              <input
                type="checkbox"
                aria-label="全选当前列表音轨"
                checked={allSelected}
                onChange={(e) =>
                  onSelectAll(e.target.checked ? tracks.map((t) => t.id) : [])
                }
              />
            </th>
            <th scope="col" style={{ width: "46px" }}>
              #
            </th>
            <th scope="col">曲目标题</th>
            <th scope="col" style={{ width: "15%" }}>
              歌手
            </th>
            <th scope="col" style={{ width: "18%" }}>
              专辑
            </th>
            <th scope="col" className="col-year" style={{ width: "62px" }}>
              年份
            </th>
            <th scope="col" className="col-spec" style={{ width: "116px" }}>
              音频规格
            </th>
            <th scope="col" style={{ width: "78px", textAlign: "right" }}>
              时长
            </th>
            <th scope="col" style={{ width: "92px" }}>
              状态
            </th>
            <th scope="col" style={{ width: "92px", textAlign: "center" }}>
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tracks.map((t) => {
            const staged = stagedMap.get(t.id);
            const p = staged?.patch;
            const isSelected = selectedIds.has(t.id);
            const isPlaying = playingTrackId === t.id;
            const hasIssue = t.diagFlags.length > 0;
            const md5Bad = t.specs.md5Verified === "mismatch";
            const issueLabel =
              t.diagFlags.length === 1
                ? describeDiagFlagsShort(t.diagFlags)
                : t.diagFlags.length > 1
                  ? `${describeDiagFlagsShort(t.diagFlags.slice(0, 1))} +${t.diagFlags.length - 1}`
                  : "";
            const thumb = p?.coverDataUrl !== undefined ? p.coverDataUrl : t.coverDataUrl;

            return (
              <tr
                key={t.id}
                aria-selected={isSelected}
                onClick={(e) =>
                  onSelectTrack(t.id, {
                    multi: e.metaKey || e.ctrlKey,
                    range: e.shiftKey,
                  })
                }
              >
                <td style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${t.title || t.fileName}`}
                    checked={isSelected}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onSelectTrack(t.id, { multi: true })}
                  />
                </td>

                {renderCell(
                  t,
                  "trackNumber",
                  t.trackNumber != null ? String(t.trackNumber).padStart(2, "0") : "",
                  p?.trackNumber !== undefined,
                  "mono"
                )}

                {renderCell(
                  t,
                  "title",
                  t.title || t.fileName,
                  p?.title !== undefined,
                  "",
                  thumb
                )}

                {renderCell(t, "artist", t.artist, p?.artist !== undefined)}

                {renderCell(t, "album", t.album, p?.album !== undefined)}

                {renderCell(t, "year", t.year, p?.year !== undefined, "mono col-year")}

                <td className="mono col-spec">
                  <span className="spec-pill">
                    {t.specs.codec} {formatRate(t.specs.sampleRate, t.specs.bitDepth)}
                  </span>
                </td>

                <td className="mono" style={{ textAlign: "right" }}>
                  <button
                    type="button"
                    className="chip-btn"
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: "0 4px",
                      minHeight: "24px",
                      color: isPlaying ? "var(--accent)" : "var(--text-secondary)",
                    }}
                    aria-label={`试听 ${t.title || t.fileName}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrack(t);
                    }}
                  >
                    <IconPlay size={11} />
                    <span className="tabular-nums">
                      {formatDuration(t.specs.durationMs)}
                    </span>
                  </button>
                </td>

                <td className={p?.newFilePath ? "cell-staged" : ""}>
                  {staged ? (
                    <span className="field-staged-tag" title={staged.reason}>
                      已暂存
                    </span>
                  ) : md5Bad ? (
                    <span style={{ color: "var(--status-danger)", fontSize: "11.5px" }}>
                      <span className="diag-dot danger" />
                      MD5异常
                    </span>
                  ) : hasIssue ? (
                    <span
                      style={{ color: "var(--staged)", fontSize: "11.5px" }}
                      title={describeDiagFlags(t.diagFlags)}
                    >
                      <span className="diag-dot warn" />
                      {issueLabel}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-tertiary)", fontSize: "11.5px" }}>
                      <span className="diag-dot ok" />
                      完备
                    </span>
                  )}
                </td>

                <td style={{ textAlign: "center" }}>
                  <div className="row-action-group">
                    <button
                      type="button"
                      className="row-delete-btn"
                      aria-label={`打开 ${t.title || t.fileName} 属性编辑器`}
                      title="属性编辑 (⌘I)"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInspectTrack(t);
                      }}
                    >
                      <IconSliders size={14} />
                    </button>
                    <button
                      type="button"
                      className="row-delete-btn danger"
                      aria-label={`删除 ${t.title || t.fileName}`}
                      title={`删除 ${t.title || t.fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRequestDeleteTracks([t.id]);
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
