import React, { useMemo, useState } from "react";
import { AlbumGroup, StagedChange, TrackRecord } from "../types/music";
import {
  IconClose,
  IconDisc,
  IconGlobe,
  IconLayers,
  IconPlay,
  IconTrash,
} from "./Icons";
import { VinylEmptyState } from "./VinylEmptyState";

interface AlbumGalleryViewProps {
  tracks: TrackRecord[];
  hasAnyTracks: boolean;
  stagedMap: Map<string, StagedChange>;
  onSelectTrackIds: (ids: string[]) => void;
  onPlayTrack: (track: TrackRecord) => void;
  onQuickUnifyAlbum: () => void;
  onOpenScraperForAlbum: (albumTracks: TrackRecord[]) => void;
  onRequestDeleteTracks: (trackIds: string[]) => void;
  onAddDirectory: () => void;
  onTriggerFileImport: () => void;
  onClearFilters: () => void;
}

export const AlbumGalleryView: React.FC<AlbumGalleryViewProps> = ({
  tracks,
  hasAnyTracks,
  stagedMap,
  onSelectTrackIds,
  onPlayTrack,
  onQuickUnifyAlbum,
  onOpenScraperForAlbum,
  onRequestDeleteTracks,
  onAddDirectory,
  onTriggerFileImport,
  onClearFilters,
}) => {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const albums = useMemo<AlbumGroup[]>(() => {
    const map = new Map<string, TrackRecord[]>();
    for (const t of tracks) {
      const aa = (t.albumArtist || t.artist || "未知歌手").trim();
      const alb = (t.album || "未命名专辑").trim();
      const key = `${aa.toLowerCase()}:::${alb.toLowerCase()}`;
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }

    const out: AlbumGroup[] = [];
    for (const [key, list] of map) {
      const sorted = [...list].sort(
        (a, b) =>
          (a.discNumber ?? 1) - (b.discNumber ?? 1) ||
          (a.trackNumber ?? 999) - (b.trackNumber ?? 999)
      );
      const first = sorted[0];
      const withCover = sorted.find((t) => t.coverDataUrl);
      const maxSr = Math.max(...sorted.map((t) => t.specs.sampleRate));
      const maxBd = Math.max(...sorted.map((t) => t.specs.bitDepth));
      const khz = (maxSr / 1000).toFixed(maxSr % 1000 === 0 ? 0 : 1);

      out.push({
        key,
        album: first.album || "未命名专辑",
        albumArtist: first.albumArtist || first.artist || "未知歌手",
        year: sorted.find((t) => t.year)?.year || "—",
        genre: sorted.find((t) => t.genre)?.genre || "—",
        pinyinInitial: first.pinyinInitial,
        coverDataUrl: withCover?.coverDataUrl ?? null,
        coverAccentHex: withCover?.coverAccentHex,
        tracks: sorted,
        hasFragmentedArtists: sorted.some((t) =>
          t.diagFlags.includes("fragmented_album")
        ),
        highestSpecLabel: `${first.specs.codec} ${maxBd}/${khz}k`,
      });
    }

    return out.sort(
      (a, b) =>
        a.pinyinInitial.localeCompare(b.pinyinInitial) ||
        a.albumArtist.localeCompare(b.albumArtist, "zh-Hans-CN")
    );
  }, [tracks]);

  const activeAlbum = albums.find((a) => a.key === expandedKey) ?? null;

  if (albums.length === 0) {
    return (
      <VinylEmptyState
        hasAnyTracks={hasAnyTracks}
        onAddDirectory={onAddDirectory}
        onTriggerFileImport={onTriggerFileImport}
        onClearFilters={onClearFilters}
      />
    );
  }

  return (
    <div className="gallery-scroller scroller">
      {activeAlbum && (
        <section
          className="album-drawer"
          aria-label={`专辑详情：${activeAlbum.album}`}
          style={
            {
              "--album-ambient": activeAlbum.coverAccentHex
                ? `color-mix(in srgb, ${activeAlbum.coverAccentHex} 16%, transparent)`
                : "transparent",
            } as React.CSSProperties
          }
        >
          <div className="album-drawer-hero">
            <div className="album-drawer-left">
              {activeAlbum.coverDataUrl ? (
                <img
                  src={activeAlbum.coverDataUrl}
                  alt={`${activeAlbum.album} 专辑封面`}
                  className="album-drawer-thumb"
                  width={76}
                  height={76}
                />
              ) : (
                <div
                  className="album-drawer-thumb"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "var(--text-tertiary)",
                  }}
                >
                  <IconDisc size={26} />
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    letterSpacing: "-0.015em",
                    color: "var(--text-primary)",
                  }}
                >
                  {activeAlbum.album}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--text-secondary)",
                    marginTop: "4px",
                  }}
                >
                  {activeAlbum.albumArtist} ·{" "}
                  <span className="mono">{activeAlbum.year}</span> ·{" "}
                  {activeAlbum.tracks.length} 首音轨 ·{" "}
                  <span className="spec-pill">{activeAlbum.highestSpecLabel}</span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" }}>
              <button
                type="button"
                className="chip-btn"
                onClick={() =>
                  onSelectTrackIds(activeAlbum.tracks.map((t) => t.id))
                }
              >
                全选整张专辑 ({activeAlbum.tracks.length})
              </button>
              {activeAlbum.hasFragmentedArtists && (
                <button
                  type="button"
                  className="chip-btn"
                  onClick={onQuickUnifyAlbum}
                >
                  <IconLayers size={13} />
                  <span>归并 Feat. 歌手</span>
                </button>
              )}
              <button
                type="button"
                className="chip-btn"
                onClick={() => onOpenScraperForAlbum(activeAlbum.tracks)}
              >
                <IconGlobe size={13} />
                <span>在线匹配封面/标签</span>
              </button>
              <button
                type="button"
                className="chip-btn danger"
                onClick={() =>
                  onRequestDeleteTracks(activeAlbum.tracks.map((t) => t.id))
                }
              >
                <IconTrash size={13} />
                <span>删除专辑</span>
              </button>
              <button
                type="button"
                className="tool-btn icon-only"
                aria-label="收起专辑详情"
                onClick={() => setExpandedKey(null)}
              >
                <IconClose size={14} />
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto", padding: "4px 12px 12px" }}>
            <table className="pro-table">
              <thead>
                <tr>
                  <th scope="col" style={{ width: "48px" }}>
                    #
                  </th>
                  <th scope="col">曲目标题</th>
                  <th scope="col">歌手</th>
                  <th scope="col" style={{ width: "126px" }}>
                    规格
                  </th>
                  <th scope="col" style={{ width: "92px" }}>
                    状态
                  </th>
                  <th scope="col" style={{ width: "46px", textAlign: "center" }}>
                    <span className="visually-hidden">删除</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeAlbum.tracks.map((t) => {
                  const isStaged = stagedMap.has(t.id);
                  return (
                    <tr
                      key={t.id}
                      onClick={() => onSelectTrackIds([t.id])}
                    >
                      <td className="mono">
                        {t.trackNumber != null
                          ? String(t.trackNumber).padStart(2, "0")
                          : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="chip-btn"
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            minHeight: "24px",
                            color: "var(--text-primary)",
                            fontWeight: 500,
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayTrack(t);
                          }}
                        >
                          <IconPlay size={11} />
                          <span>{t.title || t.fileName}</span>
                        </button>
                      </td>
                      <td style={{ color: "var(--text-secondary)" }}>
                        {t.artist || "—"}
                      </td>
                      <td className="mono">
                        {t.specs.codec} {t.specs.bitDepth}/
                        {(t.specs.sampleRate / 1000).toFixed(
                          t.specs.sampleRate % 1000 === 0 ? 0 : 1
                        )}
                        k
                      </td>
                      <td>
                        {isStaged ? (
                          <span className="field-staged-tag">已暂存</span>
                        ) : t.diagFlags.length > 0 ? (
                          <span style={{ color: "var(--staged)", fontSize: "11.5px" }}>
                            待修复
                          </span>
                        ) : (
                          <span style={{ color: "var(--text-tertiary)", fontSize: "11.5px" }}>
                            完备
                          </span>
                        )}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className="row-delete-btn"
                          aria-label={`删除 ${t.title || t.fileName}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onRequestDeleteTracks([t.id]);
                          }}
                        >
                          <IconTrash size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="gallery-grid">
        {albums.map((alb) => {
          const isActive = alb.key === expandedKey;
          const anyStaged = alb.tracks.some((t) => stagedMap.has(t.id));
          return (
            <button
              key={alb.key}
              type="button"
              className={`album-card ${isActive ? "active" : ""}`}
              onClick={() => {
                setExpandedKey(isActive ? null : alb.key);
                onSelectTrackIds(alb.tracks.map((t) => t.id));
              }}
            >
              <div className="vinyl-sleeve-wrap">
                <div className="vinyl-disc-peek" aria-hidden="true" />
                <div className="album-cover-frame">
                  {alb.coverDataUrl ? (
                    <img
                      src={alb.coverDataUrl}
                      alt={`${alb.album} 封面`}
                      loading="lazy"
                      width={300}
                      height={300}
                    />
                  ) : (
                    <div className="cover-missing-placeholder">
                      <IconDisc size={28} />
                      <span>缺失封面</span>
                    </div>
                  )}
                  <span className="codec-badge-corner">
                    {alb.highestSpecLabel}
                  </span>
                </div>
              </div>
              <div className="album-card-title" title={alb.album}>
                {alb.album}
              </div>
              <div className="album-card-sub">
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {alb.albumArtist}
                </span>
                <span className="mono" style={{ flexShrink: 0 }}>
                  {anyStaged ? (
                    <span style={{ color: "var(--staged)" }}>●</span>
                  ) : null}{" "}
                  {alb.year} · {alb.tracks.length}首
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
