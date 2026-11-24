pub mod audio_engine;
pub mod batch_tools;
pub mod library_db;
pub mod models;
pub mod organizer;
pub mod scraper;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

use chrono::Utc;
use rayon::prelude::*;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

use crate::audio_engine::{is_supported_audio, read_track_metadata, verify_flac_md5_integrity, write_tag_patch_to_file};
use crate::batch_tools::{
    compute_pinyin_initial, detect_diagnostic_flags, parse_filename_pattern,
    plan_unify_fragmented_albums, to_pinyin_sort_key,
};
use crate::library_db::LibraryDb;
use crate::models::{
    DiagnosticSummary, LibraryRoot, OnlineSearchResult, ReorganizePreviewItem, ReorganizeRule,
    StagedChange, TagPatch, TrackRecord, TransactionItem, TransactionRecord,
};
use crate::organizer::{execute_move_with_companions, preview_reorganize};
use crate::scraper::search_online_metadata;

pub struct AppState {
    pub db: Arc<LibraryDb>,
    pub cover_cache_dir: PathBuf,
}

fn attach_cached_covers(tracks: &mut [TrackRecord], cover_cache_dir: &Path) {
    for t in tracks {
        if t.cover_data_url.is_some() {
            continue;
        }
        if let Some(hash) = &t.cover_hash {
            for ext in ["jpg", "png", "webp"] {
                let candidate = cover_cache_dir.join(format!("{hash}.{ext}"));
                if candidate.exists() {
                    t.cover_data_url = Some(candidate.to_string_lossy().to_string());
                    break;
                }
            }
        }
    }
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

    // 增量重扫:size + mtime 未变的已索引文件跳过重解析。
    let existing = state.db.track_stats_under(&dir_path).unwrap_or_default();
    let candidates: Vec<(PathBuf, u64, i64)> = paths
        .iter()
        .filter_map(|p| {
            std::fs::metadata(p).ok().map(|m| {
                let mtime_ms = m
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                (p.clone(), m.len(), mtime_ms)
            })
        })
        .collect();
    let stale = paths_needing_scan(&candidates, &existing);

    let cache_dir = state.cover_cache_dir.clone();
    let mode = workspace_mode.clone();

    let mut tracks: Vec<TrackRecord> = stale
        .par_iter()
        .filter_map(|p| read_track_metadata(p, &mode, Some(&cache_dir)).ok())
        .collect();

    state.db.upsert_tracks(&tracks)?;
    // label 传 None:新根取目录名,已有根保留(可能用户自定义过的)label。
    state.db.upsert_library_root(&dir_path, None)?;
    attach_cached_covers(&mut tracks, &state.cover_cache_dir);
    Ok(tracks)
}

#[tauri::command]
async fn query_tracks(
    state: State<'_, AppState>,
    workspace_mode: String,
    search_query: Option<String>,
) -> Result<Vec<TrackRecord>, String> {
    let mut tracks = state
        .db
        .query_tracks(&workspace_mode, search_query.as_deref())?;
    attach_cached_covers(&mut tracks, &state.cover_cache_dir);
    Ok(tracks)
}

#[tauri::command]
async fn pick_directory_dialog(app: AppHandle) -> Result<Option<String>, String> {
    let app_clone = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app_clone.dialog().file().blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("文件夹选择器线程异常: {e}"))?;

    match picked {
        Some(file_path) => match file_path.into_path() {
            Ok(p) => Ok(Some(p.to_string_lossy().to_string())),
            Err(e) => Err(format!("无法解析所选目录路径: {e}")),
        },
        None => Ok(None),
    }
}

#[tauri::command]
async fn list_library_roots(state: State<'_, AppState>) -> Result<Vec<LibraryRoot>, String> {
    state.db.list_library_roots()
}

#[tauri::command]
async fn remove_library_root(state: State<'_, AppState>, dir_path: String) -> Result<(), String> {
    state.db.remove_library_root(&dir_path)
}

#[tauri::command]
async fn delete_tracks_cmd(
    state: State<'_, AppState>,
    track_ids: Vec<String>,
    delete_from_disk: bool,
) -> Result<usize, String> {
    if delete_from_disk {
        let paths = state.db.get_track_paths(&track_ids)?;
        for path_str in paths {
            let p = Path::new(&path_str);
            if p.exists() {
                std::fs::remove_file(p)
                    .map_err(|e| format!("删除本地文件失败 ({}): {e}", p.display()))?;
            }
        }
    }
    state.db.delete_tracks(&track_ids)
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

/// 从 WalkDir 候选中筛出需要重新解析的文件:未入库的新文件,或 size/mtime 已变化的文件。
fn paths_needing_scan(
    candidates: &[(PathBuf, u64, i64)],
    existing: &HashMap<String, (u64, i64)>,
) -> Vec<PathBuf> {
    candidates
        .iter()
        .filter(|(p, size, mtime)| {
            let key = p.to_string_lossy();
            match existing.get(key.as_ref()) {
                Some((s, m)) => *s != *size || *m != *mtime,
                None => true,
            }
        })
        .map(|(p, _, _)| p.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_filter_keeps_new_and_changed_only() {
        let existing: HashMap<String, (u64, i64)> = [
            ("/r/a.flac".to_string(), (100, 1000)),
            ("/r/b.flac".to_string(), (200, 2000)),
            ("/r/d.flac".to_string(), (300, 3000)),
        ]
        .into_iter()
        .collect();

        let candidates = vec![
            (PathBuf::from("/r/a.flac"), 100u64, 1000i64), // size+mtime 相同 → 跳过
            (PathBuf::from("/r/b.flac"), 201, 2000),       // size 变了 → 重扫
            (PathBuf::from("/r/c.flac"), 50, 500),         // 新文件 → 扫描
            (PathBuf::from("/r/d.flac"), 300, 3100),       // 仅 mtime 变 → 重扫
        ];

        let stale = paths_needing_scan(&candidates, &existing);
        assert_eq!(
            stale,
            vec![PathBuf::from("/r/b.flac"), PathBuf::from("/r/c.flac"), PathBuf::from("/r/d.flac")]
        );
    }
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
            pick_directory_dialog,
            list_library_roots,
            remove_library_root,
            delete_tracks_cmd,
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
