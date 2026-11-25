import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlbumGroup, StagedChange, TrackRecord } from "../types/music";
import {
  describeDiagFlags,
  describeDiagFlagsShort,
} from "../services/cjkAndBatchEngine";
import { formatDuration } from "./ProSpreadsheetView";
import {
  IconChevronLeft,
  IconDisc,
  IconLayers,
  IconPlay,
  IconTrash,
} from "./Icons";
import { VinylEmptyState } from "./VinylEmptyState";

interface AlbumGalleryViewProps {
  displayMode: "cards" | "table";
  tracks: TrackRecord[];
  hasAnyTracks: boolean;
  stagedMap: Map<string, StagedChange>;
  selectedIds: Set<string>;
  playingTrackId: string | null;
  onSelectTrackIds: (ids: string[]) => void;
  onPlayTrack: (track: TrackRecord) => void;
  onInspectTrack: (track: TrackRecord) => void;
  onQuickUnifyAlbum: () => void;
  onRequestDeleteTracks: (trackIds: string[]) => void;
  onAddDirectory: () => void;
  onTriggerFileImport: () => void;
  onClearFilters: () => void;
}

export const AlbumGalleryView: React.FC<AlbumGalleryViewProps> = ({
  displayMode,
  tracks,
  hasAnyTracks,
  stagedMap,
  selectedIds,
  playingTrackId,
  onSelectTrackIds,
  onPlayTrack,
  onInspectTrack,
  onQuickUnifyAlbum,
  onRequestDeleteTracks,
  onAddDirectory,
  onTriggerFileImport,
  onClearFilters,
}) => {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const pageRef = useRef<HTMLElement | null>(null);
  const originRectRef = useRef<DOMRect | null>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const reducedMotion = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  // FLIP: transform that would place `to`'s box exactly over `from`'s box
  // (center-origin translate + scale). Pure transform => GPU-composited.
  const flipTransform = (from: DOMRect, to: DOMRect) => {
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  };

  const closeAlbum = () => {
    if (!expandedKey || closing) return;
    const page = pageRef.current;
    if (reducedMotion.current || !page) {
      setExpandedKey(null);
      return;
    }
    // Remount the grid underneath and shrink the page back toward its origin card
    setClosing(true);
    requestAnimationFrame(() => {
      const origin = document.querySelector<HTMLElement>(
        `[data-album-key="${CSS.escape(expandedKey)}"]`
      );
      const dest = origin?.getBoundingClientRect();
      if (dest) {
        page.animate(
          [
            { transform: "none", opacity: 1 },
            { transform: flipTransform(dest, page.getBoundingClientRect()), opacity: 0.15 },
          ],
          { duration: 190, easing: "cubic-bezier(0.4, 0, 0.6, 1)" }
        );
      } else {
        page.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160 });
      }
      closeTimerRef.current = window.setTimeout(() => {
        setExpandedKey(null);
        setClosing(false);
      }, 180);
    });
  };

  const toggleAlbum = (
    key: string,
    isActive: boolean,
    el?: HTMLElement | null
  ) => {
    if (isActive) {
      closeAlbum();
      return;
    }
    originRectRef.current = el?.getBoundingClientRect() ?? null;
    setExpandedKey(key);
    if (reducedMotion.current || !originRectRef.current) return;
    requestAnimationFrame(() => {
      const page = pageRef.current;
      const from = originRectRef.current;
      if (!page || !from) return;
      page.animate(
        [
          { transform: flipTransform(from, page.getBoundingClientRect()), opacity: 0.3 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    });
  };

  useEffect(() => {
    if (!expandedKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || closing) return;
      // Don't steal Escape from open dialogs/menus layered above
      if (document.querySelector("dialog[open]")) return;
      closeAlbum();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedKey, closing]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const toggleTrackSelected = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectTrackIds([...next]);
  };

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

  const discGroups = useMemo(() => {
    if (!activeAlbum) return [];
    const m = new Map<number, TrackRecord[]>();
    for (const t of activeAlbum.tracks) {
      const d = t.discNumber ?? 1;
      const l = m.get(d) ?? [];
      l.push(t);
      m.set(d, l);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [activeAlbum]);

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
    <div className="gallery-root">
      {activeAlbum && (
        <section
          ref={pageRef}
          className={`album-page${closing ? " closing" : ""}`}
          aria-label={`专辑详情：${activeAlbum.album}`}
          style={
            {
              "--album-ambient": activeAlbum.coverAccentHex
                ? `color-mix(in srgb, ${activeAlbum.coverAccentHex} 16%, transparent)`
                : "transparent",
            } as React.CSSProperties
          }
        >
          <div className="album-page-bar">
            <button
              type="button"
              className="tool-btn album-back-btn"
              onClick={closeAlbum}
            >
              <IconChevronLeft size={14} />
              <span>专辑</span>
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
              className="tool-btn"
              style={{ marginLeft: "auto" }}
              onClick={() =>
                onSelectTrackIds(activeAlbum.tracks.map((t) => t.id))
              }
            >
              全选 {activeAlbum.tracks.length} 首
            </button>
          </div>
          <div className="album-drawer-hero">
            <div className="album-drawer-left">
              <div className="drawer-vinyl-wrap">
                <span className="drawer-vinyl" aria-hidden="true" />
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
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "19px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    color: "var(--text-primary)",
                  }}
                >
                  {activeAlbum.album}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    color: "var(--text-secondary)",
                    marginTop: "5px",
                  }}
                >
                  {activeAlbum.albumArtist} ·{" "}
                  <span className="mono">{activeAlbum.year}</span> ·{" "}
                  {activeAlbum.tracks.length} 首音轨 ·{" "}
                  <span className="spec-pill">{activeAlbum.highestSpecLabel}</span>
                </div>
              </div>
            </div>

          </div>

          <div
            className="album-drawer-tracks scroller"
            role="listbox"
            aria-label="专辑曲目"
          >
            {discGroups.map(([disc, ts]) => (
              <React.Fragment key={disc}>
                {discGroups.length > 1 && (
                  <div className="browser-disc-head">碟 {disc}</div>
                )}
                {ts.map((t) => {
                  const isStaged = stagedMap.has(t.id);
                  const isSelected = selectedIds.has(t.id);
                  const isPlaying = playingTrackId === t.id;
                  const showArtist =
                    t.artist && t.artist !== activeAlbum.albumArtist;
                  return (
                    <div
                      key={t.id}
                      role="option"
                      aria-selected={isSelected}
                      className={`dtr${isSelected ? " sel" : ""}${
                        isPlaying ? " playing" : ""
                      }`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) toggleTrackSelected(t.id);
                        else onSelectTrackIds([t.id]);
                      }}
                      onDoubleClick={() => onInspectTrack(t)}
                    >
                      <input
                        type="checkbox"
                        className="dtr-check"
                        aria-label={`选择 ${t.title || t.fileName}`}
                        checked={isSelected}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleTrackSelected(t.id)}
                      />
                      <button
                        type="button"
                        className="dtr-num"
                        aria-label={`试听 ${t.title || t.fileName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onPlayTrack(t);
                        }}
                      >
                        <span className="dtr-num-text mono">
                          {t.trackNumber != null
                            ? String(t.trackNumber).padStart(2, "0")
                            : "·"}
                        </span>
                        <IconPlay size={10} className="dtr-num-play" />
                      </button>
                      <span className="dtr-main">
                        <span className="dtr-title">{t.title || t.fileName}</span>
                        {showArtist && (
                          <span className="dtr-artist">{t.artist}</span>
                        )}
                      </span>
                      {isStaged ? (
                        <span className="field-staged-tag">已暂存</span>
                      ) : t.diagFlags.length > 0 ? (
                        <span
                          className="dtr-diag"
                          title={describeDiagFlags(t.diagFlags)}
                        >
                          {t.diagFlags.length === 1
                            ? describeDiagFlags(t.diagFlags)
                            : `${describeDiagFlags(
                                t.diagFlags.slice(0, 1)
                              )} +${t.diagFlags.length - 1}`}
                        </span>
                      ) : null}
                      <span className="dtr-dur mono tabular-nums">
                        {formatDuration(t.specs.durationMs)}
                      </span>
                      <button
                        type="button"
                        className="row-delete-btn dtr-del"
                        aria-label={`删除 ${t.title || t.fileName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRequestDeleteTracks([t.id]);
                        }}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </section>
      )}

      {(!activeAlbum || closing) && (
      <div className="gallery-scroller scroller">
        {displayMode === "table" ? (
        <div className="album-table-wrap">
          <table className="pro-table album-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: "46px" }}>
                  <span className="visually-hidden">封面</span>
                </th>
                <th scope="col">专辑</th>
                <th scope="col" style={{ width: "22%" }}>
                  专辑歌手
                </th>
                <th scope="col" style={{ width: "64px" }}>
                  年份
                </th>
                <th scope="col" style={{ width: "64px" }}>
                  曲目
                </th>
                <th scope="col" style={{ width: "126px" }}>
                  最高规格
                </th>
                <th scope="col" style={{ width: "92px" }}>
                  状态
                </th>
              </tr>
            </thead>
            <tbody>
              {albums.map((alb) => {
                const isActive = alb.key === expandedKey;
                const anyStaged = alb.tracks.some((t) => stagedMap.has(t.id));
                const albumFlags = [
                  ...new Set(alb.tracks.flatMap((t) => t.diagFlags)),
                ];
                return (
                  <tr
                    key={alb.key}
                    data-album-key={alb.key}
                    aria-selected={isActive}
                    onClick={(e) => {
                      toggleAlbum(alb.key, isActive, e.currentTarget);
                    }}
                  >
                    <td>
                      <span className="track-row-thumb">
                        {alb.coverDataUrl ? (
                          <img src={alb.coverDataUrl} alt="" />
                        ) : (
                          <IconDisc size={15} />
                        )}
                      </span>
                    </td>
                    <td style={{ fontWeight: 500 }}>{alb.album}</td>
                    <td style={{ color: "var(--text-secondary)" }}>
                      {alb.albumArtist}
                    </td>
                    <td className="mono">{alb.year}</td>
                    <td className="mono">{alb.tracks.length}</td>
                    <td>
                      <span className="spec-pill">{alb.highestSpecLabel}</span>
                    </td>
                    <td>
                      {anyStaged ? (
                        <span className="field-staged-tag">已暂存</span>
                      ) : albumFlags.length > 0 ? (
                        <span
                          style={{ color: "var(--staged)", fontSize: "11.5px" }}
                          title={describeDiagFlags(albumFlags)}
                        >
                          {describeDiagFlagsShort(albumFlags.slice(0, 1))}
                          {albumFlags.length > 1 && ` +${albumFlags.length - 1}`}
                        </span>
                      ) : (
                        <span
                          style={{
                            color: "var(--text-tertiary)",
                            fontSize: "11.5px",
                          }}
                        >
                          完备
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="gallery-grid">
          {albums.map((alb) => {
            const isActive = alb.key === expandedKey;
            const anyStaged = alb.tracks.some((t) => stagedMap.has(t.id));
            return (
              <button
                key={alb.key}
                data-album-key={alb.key}
                type="button"
                className={`album-card ${isActive ? "active" : ""}`}
                onClick={(e) => {
                  toggleAlbum(alb.key, isActive, e.currentTarget);
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
        )}
      </div>
      )}
    </div>
  );
};
