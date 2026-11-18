use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{ReorganizePreviewItem, ReorganizeRule, TrackRecord};

/// Sanitize a single path segment (artist, album, title) for macOS/Windows/Linux.
pub fn sanitize_segment(input: &str, fallback: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ => c,
        })
        .collect::<String>()
        .trim_end_matches('.')
        .trim()
        .to_string()
}

pub fn evaluate_template(track: &TrackRecord, rule: &ReorganizeRule) -> PathBuf {
    let album_artist = if !track.album_artist.trim().is_empty() {
        &track.album_artist
    } else {
        &track.artist
    };
    let track_num = track
        .track_number
        .map(|n| {
            if rule.zero_pad_track {
                format!("{n:02}")
            } else {
                format!("{n}")
            }
        })
        .unwrap_or_else(|| "00".to_string());
    let disc_num = track
        .disc_number
        .map(|n| format!("{n}"))
        .unwrap_or_else(|| "1".to_string());

    let mut rendered = rule.template.clone();
    let replacements = [
        ("{AlbumArtist}", sanitize_segment(album_artist, "Unknown Artist")),
        ("{Artist}", sanitize_segment(&track.artist, "Unknown Artist")),
        ("{Album}", sanitize_segment(&track.album, "Unknown Album")),
        ("{Year}", sanitize_segment(&track.year, "0000")),
        ("{DiscNumber}", disc_num),
        ("{TrackNumber}", track_num),
        ("{Title}", sanitize_segment(&track.title, &track.file_name)),
        ("{Format}", track.specs.codec.clone()),
        ("{ext}", track.extension.clone()),
    ];

    for (token, val) in replacements {
        rendered = rendered.replace(token, &val);
    }

    if !rendered.to_lowercase().ends_with(&format!(".{}", track.extension.to_lowercase())) {
        rendered.push('.');
        rendered.push_str(&track.extension);
    }

    Path::new(&rule.root_dir).join(rendered)
}

pub fn find_companion_files(audio_path: &Path) -> Vec<String> {
    let mut companions = Vec::new();
    let stem = audio_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if let Some(parent) = audio_path.parent() {
        for ext in ["lrc", "cue", "log"] {
            let candidate = parent.join(format!("{stem}.{ext}"));
            if candidate.exists() {
                companions.push(candidate.to_string_lossy().to_string());
            }
        }
        for cover_name in ["cover.jpg", "cover.png", "folder.jpg", "folder.png"] {
            let candidate = parent.join(cover_name);
            if candidate.exists() {
                companions.push(candidate.to_string_lossy().to_string());
            }
        }
    }
    companions
}

pub fn preview_reorganize(tracks: &[TrackRecord], rule: &ReorganizeRule) -> Vec<ReorganizePreviewItem> {
    let mut seen_targets: HashMap<String, usize> = HashMap::new();
    let mut items = Vec::with_capacity(tracks.len());

    for t in tracks {
        let target = evaluate_template(t, rule);
        let new_path = target.to_string_lossy().to_string();
        *seen_targets.entry(new_path.to_lowercase()).or_insert(0) += 1;
        let companions = if rule.move_companions {
            find_companion_files(Path::new(&t.file_path))
        } else {
            Vec::new()
        };
        let changed = new_path != t.file_path;
        items.push(ReorganizePreviewItem {
            track_id: t.id.clone(),
            old_path: t.file_path.clone(),
            new_path,
            companion_files: companions,
            conflict: false,
            changed,
        });
    }

    for item in &mut items {
        let count = seen_targets.get(&item.new_path.to_lowercase()).copied().unwrap_or(0);
        if count > 1 || (item.changed && Path::new(&item.new_path).exists()) {
            item.conflict = true;
        }
    }

    items
}

pub fn execute_move_with_companions(
    old_path: &Path,
    new_path: &Path,
    move_companions: bool,
    cleanup_empty_dirs: bool,
) -> Result<(), String> {
    if old_path == new_path {
        return Ok(());
    }
    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed creating {}: {e}", parent.display()))?;
    }
    move_file_cross_fs(old_path, new_path)?;

    if move_companions {
        let old_stem = old_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        let new_stem = new_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
        if let (Some(old_parent), Some(new_parent)) = (old_path.parent(), new_path.parent()) {
            for ext in ["lrc", "cue", "log"] {
                let src = old_parent.join(format!("{old_stem}.{ext}"));
                if src.exists() {
                    let dst = new_parent.join(format!("{new_stem}.{ext}"));
                    let _ = move_file_cross_fs(&src, &dst);
                }
            }
            for cover in ["cover.jpg", "cover.png", "folder.jpg"] {
                let src = old_parent.join(cover);
                let dst = new_parent.join(cover);
                if src.exists() && !dst.exists() {
                    let _ = fs::copy(&src, &dst);
                }
            }
        }
    }

    if cleanup_empty_dirs {
        let mut cursor = old_path.parent().map(PathBuf::from);
        let mut guard = HashSet::new();
        while let Some(dir) = cursor {
            if !guard.insert(dir.clone()) {
                break;
            }
            match fs::read_dir(&dir) {
                Ok(mut entries) => {
                    if entries.next().is_none() {
                        if fs::remove_dir(&dir).is_err() {
                            break;
                        }
                        cursor = dir.parent().map(PathBuf::from);
                    } else {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    }

    Ok(())
}

fn move_file_cross_fs(src: &Path, dst: &Path) -> Result<(), String> {
    match fs::rename(src, dst) {
        Ok(()) => Ok(()),
        Err(_) => {
            fs::copy(src, dst).map_err(|e| format!("Copy failed {}: {e}", src.display()))?;
            fs::remove_file(src).map_err(|e| format!("Remove original failed {}: {e}", src.display()))?;
            Ok(())
        }
    }
}
