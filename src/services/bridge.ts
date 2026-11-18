import { invoke } from "@tauri-apps/api/core";
import {
  DiagnosticSummary,
  OnlineSearchResult,
  ReorganizePreviewItem,
  ReorganizeRule,
  StagedChange,
  TagPatch,
  TrackRecord,
  TransactionItem,
  TransactionRecord,
  WorkspaceMode,
} from "../types/music";
import {
  computePinyinInitial,
  detectDiagnosticFlags,
  parseFilenamePattern,
  planUnifyFragmentedAlbums,
  previewDirectoryReorganize,
  toPinyinSortKey,
} from "./cjkAndBatchEngine";
import { getCuratedOnlineMatches } from "./sampleLibrary";

export function isTauriEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function applyPatchToTrack(track: TrackRecord, patch: TagPatch): TrackRecord {
  const next: TrackRecord = {
    ...track,
    title: patch.title !== undefined ? patch.title : track.title,
    artist: patch.artist !== undefined ? patch.artist : track.artist,
    albumArtist: patch.albumArtist !== undefined ? patch.albumArtist : track.albumArtist,
    album: patch.album !== undefined ? patch.album : track.album,
    year: patch.year !== undefined ? patch.year : track.year,
    genre: patch.genre !== undefined ? patch.genre : track.genre,
    trackNumber: patch.trackNumber !== undefined ? patch.trackNumber : track.trackNumber,
    totalTracks: patch.totalTracks !== undefined ? patch.totalTracks : track.totalTracks,
    discNumber: patch.discNumber !== undefined ? patch.discNumber : track.discNumber,
    totalDiscs: patch.totalDiscs !== undefined ? patch.totalDiscs : track.totalDiscs,
    comment: patch.comment !== undefined ? patch.comment : track.comment,
    lyrics: patch.lyrics !== undefined ? patch.lyrics : track.lyrics,
    artistSort: patch.artistSort !== undefined ? patch.artistSort : track.artistSort,
    albumSort: patch.albumSort !== undefined ? patch.albumSort : track.albumSort,
    coverDataUrl: patch.coverDataUrl !== undefined ? patch.coverDataUrl : track.coverDataUrl,
    coverWidth: patch.coverWidth !== undefined ? patch.coverWidth : track.coverWidth,
    coverHeight: patch.coverHeight !== undefined ? patch.coverHeight : track.coverHeight,
    coverBytes: patch.coverBytes !== undefined ? patch.coverBytes : track.coverBytes,
    coverHash:
      patch.coverDataUrl !== undefined
        ? patch.coverDataUrl
          ? `cov_custom_${track.id}`
          : null
        : track.coverHash,
    filePath: patch.newFilePath ?? track.filePath,
    fileName: patch.newFilePath
      ? patch.newFilePath.split("/").pop() || track.fileName
      : track.fileName,
  };

  next.pinyinInitial = computePinyinInitial(next.albumArtist || next.artist || next.title);
  next.diagFlags = detectDiagnosticFlags(next);
  return next;
}

export function computeDiagnosticsFromTracks(tracks: TrackRecord[]): DiagnosticSummary {
  const summary: DiagnosticSummary = {
    totalTracks: tracks.length,
    missingCover: 0,
    fragmentedAlbum: 0,
    encodingOrCjkIssue: 0,
    missingTrackOrYear: 0,
    unorganizedPath: 0,
    md5Failed: 0,
  };
  for (const t of tracks) {
    for (const f of t.diagFlags) {
      if (f === "missing_cover") summary.missingCover += 1;
      else if (f === "fragmented_album") summary.fragmentedAlbum += 1;
      else if (f === "encoding_issue") summary.encodingOrCjkIssue += 1;
      else if (f === "missing_track_or_year") summary.missingTrackOrYear += 1;
      else if (f === "unorganized_path") summary.unorganizedPath += 1;
      else if (f === "md5_mismatch") summary.md5Failed += 1;
    }
  }
  return summary;
}

export async function bridgeScanDirectory(
  dirPath: string,
  workspaceMode: WorkspaceMode
): Promise<TrackRecord[] | null> {
  if (isTauriEnvironment()) {
    return invoke<TrackRecord[]>("scan_directory", { dirPath, workspaceMode });
  }
  return null;
}

export async function bridgeCommitChanges(
  tracks: TrackRecord[],
  changes: StagedChange[],
  summary: string,
  moveCompanions: boolean,
  cleanupEmptyDirs: boolean
): Promise<{ updatedTracks: TrackRecord[]; transaction: TransactionRecord }> {
  if (isTauriEnvironment()) {
    const tx = await invoke<TransactionRecord>("commit_staged_changes", {
      changes,
      summary,
      moveCompanions,
      cleanupEmptyDirs,
    });
    const byId = new Map(changes.map((c) => [c.trackId, c.patch]));
    const updatedTracks = tracks.map((t) => {
      const p = byId.get(t.id);
      return p ? applyPatchToTrack(t, p) : t;
    });
    return { updatedTracks, transaction: tx };
  }

  // Client-side atomic commit + snapshot creation
  const changeMap = new Map(changes.map((c) => [c.trackId, c.patch]));
  const items: TransactionItem[] = [];
  const updatedTracks = tracks.map((t) => {
    const patch = changeMap.get(t.id);
    if (!patch) return t;
    const after = applyPatchToTrack(t, patch);
    items.push({
      trackId: t.id,
      opType: patch.newFilePath
        ? "file_move"
        : patch.coverDataUrl !== undefined
        ? "cover_update"
        : "tag_update",
      beforeJson: JSON.stringify(t),
      afterJson: JSON.stringify(after),
    });
    return after;
  });

  const transaction: TransactionRecord = {
    id: `tx_${Date.now()}`,
    createdAt: new Date().toISOString(),
    summary,
    itemCount: items.length,
    reverted: false,
    items,
  };

  return { updatedTracks, transaction };
}

export async function bridgePreviewReorganize(
  tracks: TrackRecord[],
  rule: ReorganizeRule
): Promise<ReorganizePreviewItem[]> {
  if (isTauriEnvironment()) {
    return invoke<ReorganizePreviewItem[]>("preview_directory_reorganize", { tracks, rule });
  }
  return previewDirectoryReorganize(tracks, rule);
}

export async function bridgePlanAlbumUnification(
  tracks: TrackRecord[]
): Promise<StagedChange[]> {
  if (isTauriEnvironment()) {
    return invoke<StagedChange[]>("plan_album_unification", { tracks });
  }
  return planUnifyFragmentedAlbums(tracks);
}

export async function bridgeParseFilenamesBatch(
  tracks: TrackRecord[],
  pattern: string
): Promise<StagedChange[]> {
  if (isTauriEnvironment()) {
    return invoke<StagedChange[]>("parse_filenames_batch", { tracks, pattern });
  }
  const out: StagedChange[] = [];
  for (const t of tracks) {
    const patch = parseFilenamePattern(t.fileName, pattern);
    if (patch) {
      out.push({
        trackId: t.id,
        patch,
        reason: `文件名解析 (${pattern})`,
      });
    }
  }
  return out;
}

export async function bridgeGeneratePinyinSort(
  tracks: TrackRecord[]
): Promise<StagedChange[]> {
  if (isTauriEnvironment()) {
    return invoke<StagedChange[]>("generate_pinyin_sort_tags", { tracks });
  }
  const out: StagedChange[] = [];
  for (const t of tracks) {
    const aSort = toPinyinSortKey(t.albumArtist || t.artist);
    const albSort = toPinyinSortKey(t.album);
    if (aSort !== t.artistSort || albSort !== t.albumSort) {
      out.push({
        trackId: t.id,
        patch: { artistSort: aSort, albumSort: albSort },
        reason: "生成 ARTISTSORT / ALBUMSORT 拼音排序标签",
      });
    }
  }
  return out;
}

export async function bridgeVerifyFlacMd5(
  track: TrackRecord
): Promise<{ status: TrackRecord["specs"]["md5Verified"]; computed: string }> {
  if (isTauriEnvironment()) {
    const [status, computed] = await invoke<[string, string]>("verify_track_md5", {
      filePath: track.filePath,
    });
    return {
      status: status as TrackRecord["specs"]["md5Verified"],
      computed,
    };
  }
  // Browser simulation for sample tracks
  if (track.specs.codec !== "FLAC") {
    return { status: "unsupported", computed: "" };
  }
  if (track.specs.md5Verified === "mismatch") {
    return { status: "mismatch", computed: "8a91fe302911002233445566778899aa" };
  }
  return {
    status: "valid",
    computed: track.specs.streamMd5 || "e4d909c290d0fb1ca068ffaddf22cbd0",
  };
}

export async function bridgeSearchOnlineReleases(
  source: OnlineSearchResult["source"],
  query: string
): Promise<OnlineSearchResult[]> {
  if (isTauriEnvironment()) {
    return invoke<OnlineSearchResult[]>("search_online_releases", { source, query });
  }
  return getCuratedOnlineMatches(query).map((item) => ({
    ...item,
    source,
  }));
}
