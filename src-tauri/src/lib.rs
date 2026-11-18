pub mod audio_engine;
pub mod batch_tools;
pub mod library_db;
pub mod models;
pub mod organizer;
pub mod scraper;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::Utc;
use rayon::prelude::*;
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use crate::audio_engine::{is_supported_audio, read_track_metadata, verify_flac_md5_integrity, write_tag_patch_to_file};
use crate::batch_tools::{
    compute_pinyin_initial, detect_diagnostic_flags, parse_filename_pattern,
    plan_unify_fragmented_albums, to_pinyin_sort_key,
};
use crate::library_db::LibraryDb;
use crate::models::{
    DiagnosticSummary, OnlineSearchResult, ReorganizePreviewItem, ReorganizeRule, StagedChange,
    TagPatch, TrackRecord, TransactionItem, TransactionRecord,
};
use crate::organizer::{execute_move_with_companions, preview_reorganize};
use crate::scraper::search_online_metadata;

pub struct AppState {
    pub db: Arc<LibraryDb>,
    pub cover_cache_dir: PathBuf,
}

#[tauri::command]
async fn scan_directory(
    state: State<'_, AppState>,
    dir_path: String,
    workspace_mode: String,
) -> Result<Vec<TrackRecord>, String> {
    let paths: Vec<PathBuf> = WalkDir::new(&dir_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && is_supported_audio(p))
        .collect();

    let cache_dir = state.cover_cache_dir.clone();
    let mode = workspace_mode.clone();

    let tracks: Vec<TrackRecord> = paths
        .par_iter()
        .filter_map(|p| read_track_metadata(p, &mode, Some(&cache_dir)).ok())
        .collect();

    state.db.upsert_tracks(&tracks)?;
    Ok(tracks)
}

#[tauri::command]
async fn query_tracks(
    state: State<'_, AppState>,
    workspace_mode: String,
    search_query: Option<String>,
) -> Result<Vec<TrackRecord>, String> {
    state
        .db
        .query_tracks(&workspace_mode, search_query.as_deref())
}

#[tauri::command]
async fn get_diagnostics(
    state: State<'_, AppState>,
    workspace_mode: String,
) -> Result<DiagnosticSummary, String> {
    state.db.compute_diagnostics(&workspace_mode)
}

#[tauri::command]
async fn commit_staged_changes(
    state: State<'_, AppState>,
    changes: Vec<StagedChange>,
    summary: String,
    move_companions: bool,
    cleanup_empty_dirs: bool,
) -> Result<TransactionRecord, String> {
    let library_tracks = state.db.query_tracks("library", None)?;
    let staging_tracks = state.db.query_tracks("staging", None)?;
    let all_tracks: Vec<TrackRecord> = library_tracks
        .into_iter()
        .chain(staging_tracks.into_iter())
        .collect();

    let mut tx_items = Vec::new();
    let mut updated_tracks = Vec::new();

    for change in &changes {
        let Some(orig) = all_tracks.iter().find(|t| t.id == change.track_id) else {
            continue;
        };
        let before_json = serde_json::to_string(orig).map_err(|e| e.to_string())?;
        let mut updated = orig.clone();
        let current_path = PathBuf::from(&orig.file_path);

        write_tag_patch_to_file(&current_path, &change.patch)?;

        if let Some(v) = &change.patch.title { updated.title = v.clone(); }
        if let Some(v) = &change.patch.artist { updated.artist = v.clone(); }
        if let Some(v) = &change.patch.album_artist { updated.album_artist = v.clone(); }
        if let Some(v) = &change.patch.album { updated.album = v.clone(); }
        if let Some(v) = &change.patch.year { updated.year = v.clone(); }
        if let Some(v) = &change.patch.genre { updated.genre = v.clone(); }
        if let Some(v) = change.patch.track_number { updated.track_number = v; }
        if let Some(v) = change.patch.total_tracks { updated.total_tracks = v; }
        if let Some(v) = change.patch.disc_number { updated.disc_number = v; }
        if let Some(v) = change.patch.total_discs { updated.total_discs = v; }
        if let Some(v) = &change.patch.comment { updated.comment = v.clone(); }
        if let Some(v) = &change.patch.lyrics { updated.lyrics = v.clone(); }
        if let Some(v) = &change.patch.artist_sort { updated.artist_sort = v.clone(); }
        if let Some(v) = &change.patch.album_sort { updated.album_sort = v.clone(); }

        if let Some(new_path) = &change.patch.new_file_path {
            execute_move_with_companions(
                &current_path,
                Path::new(new_path),
                move_companions,
                cleanup_empty_dirs,
            )?;
            updated.file_path = new_path.clone();
            updated.file_name = Path::new(new_path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&updated.file_name)
                .to_string();
        }

        let primary_artist = if !updated.album_artist.is_empty() {
            &updated.album_artist
        } else {
            &updated.artist
        };
        updated.pinyin_initial = compute_pinyin_initial(primary_artist);
        updated.diag_flags = detect_diagnostic_flags(&updated);

        let after_json = serde_json::to_string(&updated).map_err(|e| e.to_string())?;
        tx_items.push(TransactionItem {
            track_id: updated.id.clone(),
            op_type: if change.patch.new_file_path.is_some() {
                "file_move".to_string()
            } else {
                "tag_update".to_string()
            },
            before_json,
            after_json,
        });
        updated_tracks.push(updated);
    }

    state.db.upsert_tracks(&updated_tracks)?;

    let tx_rec = TransactionRecord {
        id: format!("tx_{}", Utc::now().timestamp_millis()),
        created_at: Utc::now().to_rfc3339(),
        summary,
        item_count: tx_items.len(),
        reverted: false,
        items: tx_items,
    };
    state.db.record_transaction(&tx_rec)?;
    Ok(tx_rec)
}

#[tauri::command]
async fn preview_directory_reorganize(
    tracks: Vec<TrackRecord>,
    rule: ReorganizeRule,
) -> Result<Vec<ReorganizePreviewItem>, String> {
    Ok(preview_reorganize(&tracks, &rule))
}

#[tauri::command]
async fn plan_album_unification(tracks: Vec<TrackRecord>) -> Result<Vec<StagedChange>, String> {
    Ok(plan_unify_fragmented_albums(&tracks))
}

#[tauri::command]
async fn parse_filenames_batch(
    tracks: Vec<TrackRecord>,
    pattern: String,
) -> Result<Vec<StagedChange>, String> {
    let mut out = Vec::new();
    for t in tracks {
        if let Some(patch) = parse_filename_pattern(&t.file_name, &pattern) {
            out.push(StagedChange {
                track_id: t.id,
                patch,
                reason: format!("文件名模板解析 ({pattern})"),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
async fn generate_pinyin_sort_tags(tracks: Vec<TrackRecord>) -> Result<Vec<StagedChange>, String> {
    let mut out = Vec::new();
    for t in tracks {
        let mut patch = TagPatch::default();
        let target_artist = if !t.album_artist.is_empty() {
            &t.album_artist
        } else {
            &t.artist
        };
        let a_sort = to_pinyin_sort_key(target_artist);
        let alb_sort = to_pinyin_sort_key(&t.album);
        if a_sort != t.artist_sort || alb_sort != t.album_sort {
            patch.artist_sort = Some(a_sort);
            patch.album_sort = Some(alb_sort);
            out.push(StagedChange {
                track_id: t.id,
                patch,
                reason: "生成 ARTISTSORT / ALBUMSORT 拼音排序标签".to_string(),
            });
        }
    }
    Ok(out)
}

#[tauri::command]
async fn verify_track_md5(file_path: String) -> Result<(String, String), String> {
    verify_flac_md5_integrity(Path::new(&file_path))
}

#[tauri::command]
async fn list_transactions(state: State<'_, AppState>) -> Result<Vec<TransactionRecord>, String> {
    state.db.list_transactions()
}

#[tauri::command]
async fn search_online_releases(
    source: String,
    query: String,
) -> Result<Vec<OnlineSearchResult>, String> {
    search_online_metadata(&source, &query).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle: &AppHandle = app.handle();
            let app_data = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from(".awusicmeta"));
            let db_path = app_data.join("awusic_library.sqlite");
            let cover_cache_dir = app_data.join("covers");
            let db = LibraryDb::open(&db_path).expect("Failed to initialize SQLite database");

            app.manage(AppState {
                db: Arc::new(db),
                cover_cache_dir,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_directory,
            query_tracks,
            get_diagnostics,
            commit_staged_changes,
            preview_directory_reorganize,
            plan_album_unification,
            parse_filenames_batch,
            generate_pinyin_sort_tags,
            verify_track_md5,
            list_transactions,
            search_online_releases
        ])
        .run(tauri::generate_context!())
        .expect("error while running AWuse");
}
