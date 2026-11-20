import { OnlineSearchResult, TrackRecord } from "../types/music";

function makeAlbumCoverSvg(
  title: string,
  artist: string,
  year: string,
  bgHex: string,
  fgHex: string,
  accentHex: string
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
    <rect width="600" height="600" fill="${bgHex}"/>
    <rect x="36" y="36" width="528" height="528" fill="none" stroke="${fgHex}" stroke-opacity="0.16" stroke-width="1.5"/>
    <circle cx="468" cy="132" r="56" fill="${accentHex}" fill-opacity="0.88"/>
    <line x1="36" y1="420" x2="564" y2="420" stroke="${fgHex}" stroke-opacity="0.16" stroke-width="1.5"/>
    <text x="48" y="476" font-family="-apple-system, PingFang SC, sans-serif" font-size="38" font-weight="700" fill="${fgHex}">${esc(title)}</text>
    <text x="48" y="520" font-family="-apple-system, PingFang SC, sans-serif" font-size="20" font-weight="500" fill="${fgHex}" fill-opacity="0.72">${esc(artist)}</text>
    <text x="546" y="520" text-anchor="end" font-family="SF Mono, monospace" font-size="18" fill="${fgHex}" fill-opacity="0.5">${esc(year)}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const COVERS = {
  fantasy: {
    url: makeAlbumCoverSvg("范特西 FANTASY", "周杰伦 JAY CHOU", "2001", "#1B191C", "#F4EFEA", "#B84032"),
  },
  fable: {
    url: makeAlbumCoverSvg("寓言 FABLE", "王菲 FAYE WONG", "2000", "#EFECE6", "#1C1B1A", "#8B6F4E"),
  },
  ram: {
    url: makeAlbumCoverSvg("RANDOM ACCESS MEMORIES", "DAFT PUNK", "2013", "#121214", "#EDEDEF", "#B69352"),
  },
};

export function createInitialLibraryTracks(): TrackRecord[] {
  return [];
}

export function createInitialStagingTracks(): TrackRecord[] {
  return [];
}

export function getCuratedOnlineMatches(query: string): OnlineSearchResult[] {
  const q = query.trim().toLowerCase();
  const presets: OnlineSearchResult[] = [
    {
      source: "itunes",
      releaseId: "itunes_15376689",
      album: "范特西",
      albumArtist: "周杰伦",
      year: "2001",
      genre: "Mandopop",
      coverUrl: COVERS.fantasy.url,
      coverResolution: "1500x1500",
      tracks: [
        { trackNumber: 1, discNumber: 1, title: "爱在西元前", artist: "周杰伦", durationMs: 234000 },
        { trackNumber: 2, discNumber: 1, title: "爸 我回来了", artist: "周杰伦", durationMs: 235000 },
        { trackNumber: 6, discNumber: 1, title: "安静", artist: "周杰伦", durationMs: 334000 },
        { trackNumber: 8, discNumber: 1, title: "屋顶 (feat. 温岚)", artist: "周杰伦 feat. 温岚", durationMs: 318000 },
      ],
    },
    {
      source: "netease",
      releaseId: "ne_189402",
      album: "I'm OK",
      albumArtist: "陶喆",
      year: "1999",
      genre: "R&B / Soul",
      coverUrl: makeAlbumCoverSvg("I'M OK", "陶喆 DAVID TAO", "1999", "#1E242B", "#F2F4F8", "#C86D51"),
      coverResolution: "1400x1400",
      tracks: [
        {
          trackNumber: 1,
          discNumber: 1,
          title: "找自己",
          artist: "陶喆",
          durationMs: 302000,
          lyrics: "[00:00.00]找自己 - 陶喆\n[00:18.20]哗啦啦啦啦 天在下雨\n[00:22.80]哗啦啦啦啦 云在哭泣",
        },
        {
          trackNumber: 2,
          discNumber: 1,
          title: "小镇姑娘",
          artist: "陶喆",
          durationMs: 294000,
          lyrics: "[00:00.00]小镇姑娘 - 陶喆\n[00:16.50]还记得多年前跟你手牵手",
        },
        {
          trackNumber: 4,
          discNumber: 1,
          title: "普通朋友",
          artist: "陶喆",
          durationMs: 255000,
        },
      ],
    },
    {
      source: "qqmusic",
      releaseId: "qq_0042faye",
      album: "寓言",
      albumArtist: "王菲",
      year: "2000",
      genre: "Art Pop",
      coverUrl: COVERS.fable.url,
      coverResolution: "1200x1200",
      tracks: [
        { trackNumber: 1, discNumber: 1, title: "寒武纪", artist: "王菲", durationMs: 222000 },
        { trackNumber: 10, discNumber: 1, title: "彼岸花", artist: "王菲", durationMs: 318000 },
        { trackNumber: 12, discNumber: 1, title: "笑忘书", artist: "王菲", durationMs: 266000 },
      ],
    },
    {
      source: "musicbrainz",
      releaseId: "mb_893e4012-daft",
      album: "Random Access Memories",
      albumArtist: "Daft Punk",
      year: "2013",
      genre: "Electronic",
      coverUrl: COVERS.ram.url,
      coverResolution: "1500x1500",
      tracks: [
        { trackNumber: 3, discNumber: 1, title: "Giorgio by Moroder", artist: "Daft Punk", durationMs: 544000 },
        { trackNumber: 6, discNumber: 1, title: "Lose Yourself to Dance", artist: "Daft Punk feat. Pharrell Williams", durationMs: 353000 },
        { trackNumber: 8, discNumber: 1, title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams", durationMs: 369000 },
      ],
    },
  ];

  if (!q) return presets;
  const filtered = presets.filter(
    (p) =>
      p.album.toLowerCase().includes(q) ||
      p.albumArtist.toLowerCase().includes(q) ||
      p.tracks.some((t) => t.title.toLowerCase().includes(q))
  );
  return filtered.length > 0 ? filtered : presets;
}
