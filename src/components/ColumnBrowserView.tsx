import React, { useMemo, useState } from "react";
import { StagedChange, TagPatch, TrackRecord } from "../types/music";
import { ProSpreadsheetView } from "./ProSpreadsheetView";

interface ColumnBrowserViewProps {
  tracks: TrackRecord[];
  selectedIds: Set<string>;
  stagedMap: Map<string, StagedChange>;
  playingTrackId: string | null;
  onSelectTrack: (trackId: string, opts: { multi?: boolean; range?: boolean }) => void;
  onSelectAll: (ids: string[]) => void;
  onStageFieldEdit: (trackId: string, patch: TagPatch, reason: string) => void;
  onPlayTrack: (track: TrackRecord) => void;
}

export const ColumnBrowserView: React.FC<ColumnBrowserViewProps> = ({
  tracks,
  selectedIds,
  stagedMap,
  playingTrackId,
  onSelectTrack,
  onSelectAll,
  onStageFieldEdit,
  onPlayTrack,
}) => {
  const [selectedArtist, setSelectedArtist] = useState<string>("__ALL__");
  const [selectedAlbum, setSelectedAlbum] = useState<string>("__ALL__");

  const artists = useMemo(() => {
    const map = new Map<string, { name: string; initial: string; count: number }>();
    for (const t of tracks) {
      const name = (t.albumArtist || t.artist || "未知歌手").trim();
      const prev = map.get(name);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(name, { name, initial: t.pinyinInitial, count: 1 });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        a.initial.localeCompare(b.initial) ||
        a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  }, [tracks]);

  const artistFilteredTracks = useMemo(() => {
    if (selectedArtist === "__ALL__") return tracks;
    return tracks.filter(
      (t) => (t.albumArtist || t.artist || "未知歌手").trim() === selectedArtist
    );
  }, [tracks, selectedArtist]);

  const albums = useMemo(() => {
    const map = new Map<string, { name: string; year: string; count: number }>();
    for (const t of artistFilteredTracks) {
      const name = (t.album || "未命名专辑").trim();
      const prev = map.get(name);
      if (prev) {
        prev.count += 1;
      } else {
        map.set(name, { name, year: t.year || "—", count: 1 });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.year.localeCompare(b.year) || a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  }, [artistFilteredTracks]);

  const finalTracks = useMemo(() => {
    if (selectedAlbum === "__ALL__") return artistFilteredTracks;
    return artistFilteredTracks.filter(
      (t) => (t.album || "未命名专辑").trim() === selectedAlbum
    );
  }, [artistFilteredTracks, selectedAlbum]);

  return (
    <div className="column-browser-split">
      <div className="column-browser-panes">
        <div className="browser-col">
          <div className="browser-col-header">
            <span>歌手 (按拼音首字母)</span>
            <span className="mono">{artists.length}</span>
          </div>
          <ul className="browser-col-list scroller" role="listbox" aria-label="歌手列表">
            <li>
              <button
                type="button"
                className="browser-col-item"
                aria-selected={selectedArtist === "__ALL__"}
                onClick={() => {
                  setSelectedArtist("__ALL__");
                  setSelectedAlbum("__ALL__");
                }}
              >
                <span>全部歌手 ({artists.length})</span>
                <span className="mono">{tracks.length}</span>
              </button>
            </li>
            {artists.map((a) => (
              <li key={a.name}>
                <button
                  type="button"
                  className="browser-col-item"
                  aria-selected={selectedArtist === a.name}
                  onClick={() => {
                    setSelectedArtist(a.name);
                    setSelectedAlbum("__ALL__");
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    <span
                      className="mono"
                      style={{
                        fontSize: "10px",
                        color: "var(--text-tertiary)",
                        width: "14px",
                        flexShrink: 0,
                      }}
                    >
                      {a.initial}
                    </span>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {a.name}
                    </span>
                  </span>
                  <span className="mono" style={{ color: "var(--text-tertiary)" }}>
                    {a.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="browser-col">
          <div className="browser-col-header">
            <span>专辑</span>
            <span className="mono">{albums.length}</span>
          </div>
          <ul className="browser-col-list scroller" role="listbox" aria-label="专辑列表">
            <li>
              <button
                type="button"
                className="browser-col-item"
                aria-selected={selectedAlbum === "__ALL__"}
                onClick={() => setSelectedAlbum("__ALL__")}
              >
                <span>全部专辑 ({albums.length})</span>
                <span className="mono">{artistFilteredTracks.length}</span>
              </button>
            </li>
            {albums.map((alb) => (
              <li key={alb.name}>
                <button
                  type="button"
                  className="browser-col-item"
                  aria-selected={selectedAlbum === alb.name}
                  onClick={() => setSelectedAlbum(alb.name)}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {alb.name}
                  </span>
                  <span className="mono" style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>
                    {alb.year} · {alb.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <ProSpreadsheetView
        tracks={finalTracks}
        selectedIds={selectedIds}
        stagedMap={stagedMap}
        playingTrackId={playingTrackId}
        onSelectTrack={onSelectTrack}
        onSelectAll={onSelectAll}
        onStageFieldEdit={onStageFieldEdit}
        onPlayTrack={onPlayTrack}
      />
    </div>
  );
};
