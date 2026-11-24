export type WorkspaceMode = "library" | "staging";

export type CenterViewMode = "gallery" | "columns" | "spreadsheet";

export type SidebarScope =
  | "all"
  | "artists"
  | "albums"
  | "folders"
  | "diag_missing_cover"
  | "diag_fragmented_album"
  | "diag_encoding_issue"
  | "diag_missing_track_or_year"
  | "diag_unorganized_path"
  | "diag_md5_mismatch";

export type ThemePreference = "system" | "dark" | "light";

export type BatchModalKind =
  | null
  | "reorganize"
  | "unify"
  | "filename"
  | "cjk"
  | "scraper"
  | "staged_queue"
  | "md5_audit";

export interface AudioSpecs {
  codec: string;
  sampleRate: number;
  bitDepth: number;
  channels: number;
  bitrateKbps: number;
  durationMs: number;
  streamMd5: string;
  md5Verified: "valid" | "mismatch" | "unknown" | "unverified" | "unsupported";
}

export interface TrackRecord {
  id: string;
  workspaceMode: WorkspaceMode;
  filePath: string;
  fileName: string;
  extension: string;
  fileSize: number;
  mtimeMs: number;

  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  year: string;
  genre: string;
  trackNumber: number | null;
  totalTracks: number | null;
  discNumber: number | null;
  totalDiscs: number | null;
  comment: string;
  lyrics: string;
  hasExternalLrc: boolean;

  artistSort: string;
  albumSort: string;
  pinyinInitial: string;

  specs: AudioSpecs;

  coverHash: string | null;
  coverWidth: number;
  coverHeight: number;
  coverBytes: number;
  coverDataUrl: string | null;
  coverAccentHex?: string;

  diagFlags: string[];
  /** 曲目所属网络根当前离线:置灰展示、不可播放、不可编辑 */
  isOffline?: boolean;
  /** Optional local ObjectURL for real dropped audio files so WebAudio/HTMLAudio can play them */
  objectUrl?: string;
}

export interface TagPatch {
  title?: string;
  artist?: string;
  albumArtist?: string;
  album?: string;
  year?: string;
  genre?: string;
  trackNumber?: number | null;
  totalTracks?: number | null;
  discNumber?: number | null;
  totalDiscs?: number | null;
  comment?: string;
  lyrics?: string;
  artistSort?: string;
  albumSort?: string;
  coverDataUrl?: string | null;
  coverWidth?: number;
  coverHeight?: number;
  coverBytes?: number;
  newFilePath?: string;
}

export interface StagedChange {
  trackId: string;
  patch: TagPatch;
  reason: string;
}

export interface TransactionItem {
  trackId: string;
  opType: "tag_update" | "file_move" | "cover_update";
  beforeJson: string;
  afterJson: string;
}

export interface TransactionRecord {
  id: string;
  createdAt: string;
  summary: string;
  itemCount: number;
  reverted: boolean;
  items: TransactionItem[];
}

export interface ReorganizeRule {
  rootDir: string;
  template: string;
  moveCompanions: boolean;
  cleanupEmptyDirs: boolean;
  zeroPadTrack: boolean;
}

export interface ReorganizePreviewItem {
  trackId: string;
  oldPath: string;
  newPath: string;
  companionFiles: string[];
  conflict: boolean;
  changed: boolean;
}

export interface DiagnosticSummary {
  totalTracks: number;
  missingCover: number;
  fragmentedAlbum: number;
  encodingOrCjkIssue: number;
  missingTrackOrYear: number;
  unorganizedPath: number;
  md5Failed: number;
}

export interface OnlineTrackMatch {
  trackNumber: number;
  discNumber: number;
  title: string;
  artist: string;
  durationMs: number;
  lyrics?: string;
}

export interface OnlineSearchResult {
  source: "musicbrainz" | "itunes" | "netease" | "qqmusic";
  releaseId: string;
  album: string;
  albumArtist: string;
  year: string;
  genre: string;
  coverUrl: string | null;
  coverResolution: string | null;
  tracks: OnlineTrackMatch[];
}

export interface LibraryRoot {
  id: number | string;
  path: string;
  label: string;
  addedAt: string;
  lastScan: string | null;
  trackCount: number;
  sourceUri: string | null;
  isNetwork: boolean;
  isOffline: boolean;
}

export type FinderRuleTarget =
  | "fileName"
  | "title"
  | "artist"
  | "albumArtist"
  | "album"
  | "genre"
  | "year"
  | "comment"
  | "trackNumber";

export type FinderRuleMode = "replace" | "add" | "format" | "template";

export interface FinderBatchRule {
  targetField: FinderRuleTarget;
  mode: FinderRuleMode;
  // Mode 1: replace
  findText: string;
  replaceText: string;
  useRegex: boolean;
  caseSensitive: boolean;
  // Mode 2: add
  addText: string;
  addPosition: "before" | "after";
  // Mode 3: format (sequence)
  formatBaseMode: "keep" | "custom";
  customBaseText: string;
  formatPosition: "before" | "after";
  separator: string;
  startIndex: number;
  step: number;
  zeroPad: number;
  // Mode 4: template <-> filename
  templateDirection: "extract_from_filename" | "rename_from_tags";
  extractPattern: string;
  renamePattern: string;
  zeroPadTrack: boolean;
}

export interface AlbumGroup {
  key: string;
  album: string;
  albumArtist: string;
  year: string;
  genre: string;
  pinyinInitial: string;
  coverDataUrl: string | null;
  coverAccentHex?: string;
  tracks: TrackRecord[];
  hasFragmentedArtists: boolean;
  highestSpecLabel: string;
}
