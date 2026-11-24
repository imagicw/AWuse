use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpecs {
    pub codec: String,
    pub sample_rate: u32,
    pub bit_depth: u8,
    pub channels: u8,
    pub bitrate_kbps: u32,
    pub duration_ms: u64,
    pub stream_md5: String,
    pub md5_verified: String, // "valid" | "mismatch" | "unknown" | "unsupported"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackRecord {
    pub id: String,
    pub workspace_mode: String, // "library" | "staging"
    pub file_path: String,
    pub file_name: String,
    pub extension: String,
    pub file_size: u64,
    pub mtime_ms: i64,

    pub title: String,
    pub artist: String,
    pub album_artist: String,
    pub album: String,
    pub year: String,
    pub genre: String,
    pub track_number: Option<u32>,
    pub total_tracks: Option<u32>,
    pub disc_number: Option<u32>,
    pub total_discs: Option<u32>,
    pub comment: String,
    pub lyrics: String,
    pub has_external_lrc: bool,

    pub artist_sort: String,
    pub album_sort: String,
    pub pinyin_initial: String,

    pub specs: AudioSpecs,

    pub cover_hash: Option<String>,
    pub cover_width: u32,
    pub cover_height: u32,
    pub cover_bytes: u64,
    pub cover_data_url: Option<String>,

    pub diag_flags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagPatch {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album_artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<Option<u32>>,
    pub total_tracks: Option<Option<u32>>,
    pub disc_number: Option<Option<u32>>,
    pub total_discs: Option<Option<u32>>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub artist_sort: Option<String>,
    pub album_sort: Option<String>,
    pub cover_data_url: Option<String>,
    pub new_file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedChange {
    pub track_id: String,
    pub patch: TagPatch,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionItem {
    pub track_id: String,
    pub op_type: String,
    pub before_json: String,
    pub after_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TransactionRecord {
    pub id: String,
    pub created_at: String,
    pub summary: String,
    pub item_count: usize,
    pub reverted: bool,
    pub items: Vec<TransactionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorganizeRule {
    pub root_dir: String,
    pub template: String,
    pub move_companions: bool,
    pub cleanup_empty_dirs: bool,
    pub zero_pad_track: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorganizePreviewItem {
    pub track_id: String,
    pub old_path: String,
    pub new_path: String,
    pub companion_files: Vec<String>,
    pub conflict: bool,
    pub changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSummary {
    pub total_tracks: usize,
    pub missing_cover: usize,
    pub fragmented_album: usize,
    pub encoding_or_cjk_issue: usize,
    pub missing_track_or_year: usize,
    pub unorganized_path: usize,
    pub md5_failed: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineTrackMatch {
    pub track_number: u32,
    pub disc_number: u32,
    pub title: String,
    pub artist: String,
    pub duration_ms: u64,
    pub lyrics: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineSearchResult {
    pub source: String, // "musicbrainz" | "itunes" | "netease" | "qqmusic"
    pub release_id: String,
    pub album: String,
    pub album_artist: String,
    pub year: String,
    pub genre: String,
    pub cover_url: Option<String>,
    pub cover_resolution: Option<String>,
    pub tracks: Vec<OnlineTrackMatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRoot {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub added_at: String,
    pub last_scan: Option<String>,
    pub track_count: usize,
    pub source_uri: Option<String>,
    pub is_network: bool,
    /// 运行时计算:网络根的挂载点当前不可达即为离线,不入库。
    pub is_offline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkMountResult {
    /// 挂载点 + 共享内子路径合成的扫描根路径。
    pub root_path: String,
    pub tracks: Vec<TrackRecord>,
}
