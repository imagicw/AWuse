import React, { useState, useRef } from "react";
import { StagedChange, TagPatch, TrackRecord } from "../types/music";
import { IconPlay } from "./Icons";

interface ProSpreadsheetViewProps {
  tracks: TrackRecord[];
  selectedIds: Set<string>;
  stagedMap: Map<string, StagedChange>;
  playingTrackId: string | null;
  onSelectTrack: (trackId: string, opts: { multi?: boolean; range?: boolean }) => void;
  onSelectAll: (ids: string[]) => void;
  onStageFieldEdit: (trackId: string, patch: TagPatch, reason: string) => void;
  onPlayTrack: (track: TrackRecord) => void;
}

type EditableField =
  | "trackNumber"
  | "title"
  | "artist"
  | "albumArtist"
  | "album"
  | "year"
  | "genre";

function formatDuration(ms: number): string {
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
  selectedIds,
  stagedMap,
  playingTrackId,
  onSelectTrack,
  onSelectAll,
  onStageFieldEdit,
  onPlayTrack,
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
    extraClass = ""
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
        {displayVal || <span style={{ color: "var(--text-tertiary)" }}>—</span>}
      </td>
    );
  };

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
            <th scope="col" style={{ width: "36px", textAlign: "center" }}>
              <input
                type="checkbox"
                aria-label="全选当前列表音轨"
                checked={allSelected}
                onChange={(e) =>
                  onSelectAll(e.target.checked ? tracks.map((t) => t.id) : [])
                }
              />
            </th>
            <th scope="col" style={{ width: "44px" }}>
              #
            </th>
            <th scope="col" style={{ width: "22%" }}>
              曲目标题
            </th>
            <th scope="col" style={{ width: "16%" }}>
              歌手 (Artist)
            </th>
            <th scope="col" style={{ width: "15%" }}>
              专辑歌手 (Album Artist)
            </th>
            <th scope="col" style={{ width: "18%" }}>
              专辑 (Album)
            </th>
            <th scope="col" style={{ width: "64px" }}>
              年份
            </th>
            <th scope="col" style={{ width: "100px" }}>
              流派
            </th>
            <th scope="col" style={{ width: "112px" }}>
              音频规格
            </th>
            <th scope="col" style={{ width: "62px", textAlign: "right" }}>
              时长
            </th>
            <th scope="col" style={{ width: "92px" }}>
              状态 / MD5
            </th>
          </tr>
        </thead>
        <tbody>
          {tracks.length === 0 ? (
            <tr>
              <td
                colSpan={11}
                style={{
                  textAlign: "center",
                  padding: "36px 12px",
                  color: "var(--text-tertiary)",
                }}
              >
                当前筛选下没有匹配的音频文件
              </td>
            </tr>
          ) : (
            tracks.map((t) => {
              const staged = stagedMap.get(t.id);
              const p = staged?.patch;
              const isSelected = selectedIds.has(t.id);
              const isPlaying = playingTrackId === t.id;
              const hasIssue = t.diagFlags.length > 0;
              const md5Bad = t.specs.md5Verified === "mismatch";

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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "4px",
                      }}
                    >
                      <input
                        type="checkbox"
                        aria-label={`选择 ${t.title || t.fileName}`}
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() =>
                          onSelectTrack(t.id, { multi: true })
                        }
                      />
                    </div>
                  </td>

                  {renderCell(
                    t,
                    "trackNumber",
                    t.trackNumber != null
                      ? String(t.trackNumber).padStart(2, "0")
                      : "",
                    p?.trackNumber !== undefined,
                    "mono"
                  )}

                  {renderCell(
                    t,
                    "title",
                    t.title || t.fileName,
                    p?.title !== undefined
                  )}

                  {renderCell(t, "artist", t.artist, p?.artist !== undefined)}

                  {renderCell(
                    t,
                    "albumArtist",
                    t.albumArtist,
                    p?.albumArtist !== undefined
                  )}

                  {renderCell(t, "album", t.album, p?.album !== undefined)}

                  {renderCell(t, "year", t.year, p?.year !== undefined, "mono")}

                  {renderCell(t, "genre", t.genre, p?.genre !== undefined)}

                  <td className="mono">
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
                        minHeight: "20px",
                        color: isPlaying ? "var(--accent)" : "var(--text-secondary)",
                      }}
                      aria-label={`试听 ${t.title || t.fileName}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlayTrack(t);
                      }}
                    >
                      <IconPlay size={10} />
                      <span className="tabular-nums">
                        {formatDuration(t.specs.durationMs)}
                      </span>
                    </button>
                  </td>

                  <td className={p?.newFilePath ? "cell-staged" : ""}>
                    {staged ? (
                      <span
                        className="field-staged-tag"
                        title={staged.reason}
                      >
                        已暂存
                      </span>
                    ) : md5Bad ? (
                      <span style={{ color: "var(--status-danger)", fontSize: "11px" }}>
                        <span className="diag-dot danger" />
                        MD5异常
                      </span>
                    ) : hasIssue ? (
                      <span style={{ color: "var(--staged)", fontSize: "11px" }}>
                        <span className="diag-dot warn" />
                        待修复({t.diagFlags.length})
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)", fontSize: "11px" }}>
                        <span className="diag-dot ok" />
                        完备
                      </span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
