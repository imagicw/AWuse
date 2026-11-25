import React, { useMemo, useState } from "react";
import {
  SidebarScope,
  StagedChange,
  TagPatch,
  TrackRecord,
} from "../types/music";
import { ProSpreadsheetView, formatDuration } from "./ProSpreadsheetView";
import { IconDisc, IconPlay, IconSliders, IconTrash } from "./Icons";

interface ColumnBrowserViewProps {
  scope: SidebarScope;
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

const ALL = "__ALL__";

// Artist-detail ordering: album year → album name → disc → track → title
function byTrackOrder(a: TrackRecord, b: TrackRecord): number {
  return (
    (a.year || "").localeCompare(b.year || "") ||
    (a.album || "").localeCompare(b.album || "", "zh-Hans-CN") ||
    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
    (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) ||
    (a.title || a.fileName).localeCompare(b.title || b.fileName, "zh-Hans-CN")
  );
}

// Folder ordering: album → disc → track → title within the directory
function byDirOrder(a: TrackRecord, b: TrackRecord): number {
  return (
    (a.album || "").localeCompare(b.album || "", "zh-Hans-CN") ||
    (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
    (a.trackNumber ?? 9999) - (b.trackNumber ?? 9999) ||
    (a.title || a.fileName).localeCompare(b.title || b.fileName, "zh-Hans-CN")
  );
}

interface TrackGroup {
  key: string;
  album: string;
  meta: string;
  cover: string | null;
  discs: [number, TrackRecord[]][];
}

function groupTracksByAlbum(tracks: TrackRecord[]): TrackGroup[] {
  type MutableGroup = {
    key: string;
    album: string;
    meta: string;
    cover: string | null;
    discMap: Map<number, TrackRecord[]>;
  };
  const out: MutableGroup[] = [];
  const byAlbum = new Map<string, MutableGroup>();
  for (const t of tracks) {
    const album = (t.album || "未命名专辑").trim();
    const key = `${t.albumArtist || t.artist || ""}\u0000${album}`;
    let g = byAlbum.get(key);
    if (!g) {
      g = {
        key,
        album,
        meta: `${t.year || "—"} · ${t.albumArtist || t.artist || ""}`,
        cover: null,
        discMap: new Map(),
      };
      byAlbum.set(key, g);
      out.push(g);
    }
    const d = t.discNumber ?? 1;
    const list = g.discMap.get(d);
    if (list) list.push(t);
    else g.discMap.set(d, [t]);
    if (!g.cover && t.coverDataUrl) g.cover = t.coverDataUrl;
  }
  return out.map((g) => ({
    key: g.key,
    album: g.album,
    meta: g.meta,
    cover: g.cover,
    discs: Array.from(g.discMap.entries()).sort((a, b) => a[0] - b[0]),
  }));
}

function dirOf(filePath: string): string {
  const i = filePath.lastIndexOf("/");
  return i > 0 ? filePath.slice(0, i) : filePath;
}

function baseName(path: string): string {
  const i = path.lastIndexOf("/");
  return i >= 0 ? path.slice(i + 1) : path;
}

const TrackColumn: React.FC<{
  tracks: TrackRecord[];
  header: string;
  selectedIds: Set<string>;
  stagedMap: Map<string, StagedChange>;
  playingTrackId: string | null;
  onSelectTrack: ColumnBrowserViewProps["onSelectTrack"];
  onSelectAll: (ids: string[]) => void;
  onPlayTrack: (t: TrackRecord) => void;
  onInspectTrack: (t: TrackRecord) => void;
  onRequestDeleteTracks: (ids: string[]) => void;
}> = ({
  tracks,
  header,
  selectedIds,
  stagedMap,
  playingTrackId,
  onSelectTrack,
  onSelectAll,
  onPlayTrack,
  onInspectTrack,
  onRequestDeleteTracks,
}) => {
  const groups = useMemo(() => groupTracksByAlbum(tracks), [tracks]);
  const multiAlbum = groups.length > 1;
  return (
  <div className="browser-col">
    <div className="browser-col-header">
      <span>{header}</span>
      <span className="browser-col-header-actions">
        {tracks.length > 0 && (
          <button
            type="button"
            className="browser-col-selectall"
            onClick={() => onSelectAll(tracks.map((t) => t.id))}
          >
            全选
          </button>
        )}
        <span className="mono">{tracks.length}</span>
      </span>
    </div>
    <ul className="browser-col-list scroller" role="listbox" aria-label="曲目列表">
      {tracks.length === 0 ? (
        <li className="browser-col-empty">先在左侧选择分组</li>
      ) : (
        groups.map((g) => (
          <React.Fragment key={g.key}>
            {multiAlbum && (
              <li className="browser-album-head" title={g.album}>
                <span className="bah-cover" aria-hidden="true">
                  {g.cover ? (
                    <img src={g.cover} alt="" loading="lazy" />
                  ) : (
                    <IconDisc size={11} />
                  )}
                </span>
                <span className="bah-name">{g.album}</span>
                <span className="bah-meta tabular-nums">{g.meta}</span>
              </li>
            )}
            {g.discs.map(([disc, ts]) => (
              <React.Fragment key={disc}>
                {g.discs.length > 1 && (
                  <li className="browser-disc-head">碟 {disc}</li>
                )}
                {ts.map((t) => {
                  const sel = selectedIds.has(t.id);
                  const staged = stagedMap.has(t.id);
                  const playing = playingTrackId === t.id;
                  return (
                    <li key={t.id}>
                      <div
                        role="option"
                        aria-selected={sel}
                        className={`browser-track-item${sel ? " sel" : ""}`}
                        onClick={(e) =>
                          onSelectTrack(t.id, {
                            multi: e.metaKey || e.ctrlKey,
                            range: e.shiftKey,
                          })
                        }
                        onDoubleClick={() => onInspectTrack(t)}
                      >
                <span className="btr-num mono">
                  {t.trackNumber != null
                    ? String(t.trackNumber).padStart(2, "0")
                    : "·"}
                </span>
                <span className="btr-thumb" aria-hidden="true">
                  {t.coverDataUrl ? (
                    <img src={t.coverDataUrl} alt="" loading="lazy" />
                  ) : (
                    <IconDisc size={13} />
                  )}
                </span>
                <span className="btr-title">{t.title || t.fileName}</span>
                {staged && <span className="field-staged-tag">已暂存</span>}
                <span className="btr-actions">
                  <button
                    type="button"
                    className="row-delete-btn"
                    aria-label={`试听 ${t.title || t.fileName}`}
                    title="试听"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlayTrack(t);
                    }}
                  >
                    <IconPlay size={11} />
                  </button>
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
                    <IconSliders size={13} />
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
                    <IconTrash size={13} />
                  </button>
                </span>
                <span
                  className={`btr-dur mono${playing ? " playing" : ""}`}
                >
                  {formatDuration(t.specs.durationMs)}
                </span>
              </div>
                    </li>
                  );
                })}
              </React.Fragment>
            ))}
          </React.Fragment>
        ))
      )}
    </ul>
  </div>
  );
};

export const ColumnBrowserView: React.FC<ColumnBrowserViewProps> = ({
  scope,
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
  const [selectedArtist, setSelectedArtist] = useState<string>(ALL);
  const [selectedAlbum, setSelectedAlbum] = useState<string>(ALL);
  const [selectedDir, setSelectedDir] = useState<string>(ALL);

  const folderMode = scope === "folders";

  const artists = useMemo(() => {
    const map = new Map<
      string,
      { name: string; initial: string; count: number; cover: string | null }
    >();
    for (const t of tracks) {
      const name = (t.albumArtist || t.artist || "未知歌手").trim();
      const prev = map.get(name);
      if (prev) {
        prev.count += 1;
        if (!prev.cover && t.coverDataUrl) prev.cover = t.coverDataUrl;
      } else {
        map.set(name, {
          name,
          initial: t.pinyinInitial || "#",
          count: 1,
          cover: t.coverDataUrl,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        a.initial.localeCompare(b.initial) ||
        a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  }, [tracks]);

  const artistGroups = useMemo(() => {
    const g = new Map<string, typeof artists>();
    for (const a of artists) {
      const k = a.initial || "#";
      const list = g.get(k);
      if (list) list.push(a);
      else g.set(k, [a]);
    }
    return Array.from(g.entries());
  }, [artists]);

  const artistFilteredTracks = useMemo(() => {
    if (selectedArtist === ALL) return tracks;
    return tracks.filter(
      (t) => (t.albumArtist || t.artist || "未知歌手").trim() === selectedArtist
    );
  }, [tracks, selectedArtist]);

  const albums = useMemo(() => {
    const map = new Map<
      string,
      { name: string; year: string; count: number; cover: string | null }
    >();
    for (const t of artistFilteredTracks) {
      const name = (t.album || "未命名专辑").trim();
      const prev = map.get(name);
      if (prev) {
        prev.count += 1;
        if (!prev.cover && t.coverDataUrl) prev.cover = t.coverDataUrl;
      } else {
        map.set(name, {
          name,
          year: t.year || "—",
          count: 1,
          cover: t.coverDataUrl,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        a.year.localeCompare(b.year) || a.name.localeCompare(b.name, "zh-Hans-CN")
    );
  }, [artistFilteredTracks]);

  const allAlbumCovers = useMemo(
    () => albums.filter((a) => a.cover).slice(0, 3),
    [albums]
  );

  const finalTracks = useMemo(() => {
    const list =
      selectedAlbum === ALL
        ? artistFilteredTracks
        : artistFilteredTracks.filter(
            (t) => (t.album || "未命名专辑").trim() === selectedAlbum
          );
    return [...list].sort(byTrackOrder);
  }, [artistFilteredTracks, selectedAlbum]);

  const dirs = useMemo(() => {
    const map = new Map<string, { dir: string; count: number }>();
    for (const t of tracks) {
      const dir = dirOf(t.filePath);
      const prev = map.get(dir);
      if (prev) prev.count += 1;
      else map.set(dir, { dir, count: 1 });
    }
    return Array.from(map.values()).sort((a, b) =>
      a.dir.localeCompare(b.dir)
    );
  }, [tracks]);

  const dirTracks = useMemo(() => {
    const list =
      selectedDir === ALL
        ? tracks
        : tracks.filter((t) => dirOf(t.filePath) === selectedDir);
    return [...list].sort(byDirOrder);
  }, [tracks, selectedDir]);

  if (tracks.length === 0) {
    return (
      <ProSpreadsheetView
        tracks={tracks}
        hasAnyTracks={hasAnyTracks}
        selectedIds={selectedIds}
        stagedMap={stagedMap}
        playingTrackId={playingTrackId}
        onSelectTrack={onSelectTrack}
        onSelectAll={onSelectAll}
        onStageFieldEdit={onStageFieldEdit}
        onPlayTrack={onPlayTrack}
        onInspectTrack={onInspectTrack}
        onRequestDeleteTracks={onRequestDeleteTracks}
        onAddDirectory={onAddDirectory}
        onTriggerFileImport={onTriggerFileImport}
        onClearFilters={onClearFilters}
      />
    );
  }

  if (folderMode) {
    return (
      <div className="column-browser folder-mode">
        <div className="browser-col">
          <div className="browser-col-header">
            <span>目录 (按所在路径)</span>
            <span className="mono">{dirs.length}</span>
          </div>
          <ul className="browser-col-list scroller" role="listbox" aria-label="目录列表">
            <li>
              <button
                type="button"
                className="browser-col-item"
                aria-selected={selectedDir === ALL}
                onClick={() => setSelectedDir(ALL)}
              >
                <span>全部目录 ({dirs.length})</span>
                <span className="mono">{tracks.length}</span>
              </button>
            </li>
            {dirs.map((d) => (
              <li key={d.dir}>
                <button
                  type="button"
                  className="browser-col-item"
                  aria-selected={selectedDir === d.dir}
                  title={d.dir}
                  onClick={() => setSelectedDir(d.dir)}
                >
                  <span className="browser-dir-item">
                    <span className="browser-dir-name">{baseName(d.dir)}</span>
                    <span className="browser-dir-path">{d.dir}</span>
                  </span>
                  <span className="mono" style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>
                    {d.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <TrackColumn
          tracks={dirTracks}
          header={selectedDir === ALL ? "全部曲目" : baseName(selectedDir)}
          selectedIds={selectedIds}
          stagedMap={stagedMap}
          playingTrackId={playingTrackId}
          onSelectTrack={onSelectTrack}
          onSelectAll={onSelectAll}
          onPlayTrack={onPlayTrack}
          onInspectTrack={onInspectTrack}
          onRequestDeleteTracks={onRequestDeleteTracks}
        />
      </div>
    );
  }

  return (
    <div className="column-browser artist-mode">
      <div className="browser-col artist-list-col">
        <div className="browser-col-header">
          <span>歌手</span>
          <span className="mono">{artists.length}</span>
        </div>
        <ul className="browser-col-list scroller" role="listbox" aria-label="歌手列表">
          <li>
            <button
              type="button"
              className="browser-col-item"
              aria-selected={selectedArtist === ALL}
              onClick={() => {
                setSelectedArtist(ALL);
                setSelectedAlbum(ALL);
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                <span className="artist-avatar" aria-hidden="true">
                  <IconDisc size={12} />
                </span>
                <span>全部歌手</span>
              </span>
              <span className="mono" style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>
                {tracks.length}
              </span>
            </button>
          </li>
          {artistGroups.map(([letter, group]) => (
            <React.Fragment key={letter}>
              <li className="browser-section-head" aria-hidden="true">
                {letter}
              </li>
              {group.map((a) => (
                <li key={a.name}>
                  <button
                    type="button"
                    className="browser-col-item"
                    aria-selected={selectedArtist === a.name}
                    onClick={() => {
                      setSelectedArtist(a.name);
                      setSelectedAlbum(ALL);
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                      <span className="artist-avatar" aria-hidden="true">
                        {a.cover ? (
                          <img src={a.cover} alt="" loading="lazy" />
                        ) : (
                          <span className="artist-avatar-letter">{a.initial}</span>
                        )}
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
                    <span className="mono" style={{ color: "var(--text-tertiary)", flexShrink: 0 }}>
                      {a.count}
                    </span>
                  </button>
                </li>
              ))}
            </React.Fragment>
          ))}
        </ul>
      </div>

      <div className="artist-detail">
        <div className="artist-detail-head">
          <h3>{selectedArtist === ALL ? "全部歌手" : selectedArtist}</h3>
          <div className="artist-detail-sub tabular-nums">
            {albums.length} 张专辑 · {artistFilteredTracks.length} 首音轨
            {selectedAlbum !== ALL ? ` · 正在浏览「${selectedAlbum}」` : ""}
          </div>
        </div>

        <div className="artist-album-strip scroller" role="listbox" aria-label="专辑选择">
          <button
            type="button"
            className="artist-album-card"
            aria-selected={selectedAlbum === ALL}
            onClick={() => setSelectedAlbum(ALL)}
          >
            <span className="aac-cover aac-cover-all" aria-hidden="true">
              {allAlbumCovers.length === 0 ? (
                <IconDisc size={22} />
              ) : (
                <span className="aac-stack">
                  {allAlbumCovers.map((a, i) => {
                    const n = allAlbumCovers.length;
                    const angle =
                      n === 1 ? 0 : n === 2 ? (i === 0 ? -9 : 9) : (i - 1) * 14;
                    const mid = Math.floor((n - 1) / 2);
                    return (
                      <img
                        key={a.name}
                        src={a.cover ?? undefined}
                        alt=""
                        style={{
                          transform: `translateX(-50%) rotate(${angle}deg)`,
                          zIndex: n - Math.abs(i - mid),
                        }}
                      />
                    );
                  })}
                </span>
              )}
            </span>
            <span className="aac-name">全部专辑</span>
            <span className="aac-meta tabular-nums">{albums.length} 张</span>
          </button>
          {albums.map((alb) => (
            <button
              key={alb.name}
              type="button"
              className="artist-album-card"
              aria-selected={selectedAlbum === alb.name}
              title={alb.name}
              onClick={() =>
                setSelectedAlbum(selectedAlbum === alb.name ? ALL : alb.name)
              }
            >
              <span className="aac-cover" aria-hidden="true">
                {alb.cover ? (
                  <img src={alb.cover} alt="" loading="lazy" />
                ) : (
                  <IconDisc size={20} />
                )}
              </span>
              <span className="aac-name">{alb.name}</span>
              <span className="aac-meta tabular-nums">
                {alb.year} · {alb.count} 首
              </span>
            </button>
          ))}
        </div>

        <TrackColumn
          tracks={finalTracks}
          header={
            selectedAlbum === ALL
              ? selectedArtist === ALL
                ? "全部曲目"
                : `${selectedArtist} · 全部曲目`
              : selectedAlbum
          }
          selectedIds={selectedIds}
          stagedMap={stagedMap}
          playingTrackId={playingTrackId}
          onSelectTrack={onSelectTrack}
          onSelectAll={onSelectAll}
          onPlayTrack={onPlayTrack}
          onInspectTrack={onInspectTrack}
          onRequestDeleteTracks={onRequestDeleteTracks}
        />
      </div>
    </div>
  );
};
