use std::collections::HashMap;
use std::path::Path;

use encoding_rs::{BIG5, GB18030, SHIFT_JIS};
use pinyin::ToPinyin;
use regex::Regex;

use crate::models::{StagedChange, TagPatch, TrackRecord};

/// Compute single A-Z or # index bucket for CJK / Latin / Kana strings.
pub fn compute_pinyin_initial(text: &str) -> String {
    let trimmed = text.trim();
    let Some(first_char) = trimmed.chars().next() else {
        return "#".to_string();
    };
    if first_char.is_ascii_alphabetic() {
        return first_char.to_ascii_uppercase().to_string();
    }
    if let Some(py) = first_char.to_pinyin() {
        if let Some(ch) = py.plain().chars().next() {
            return ch.to_ascii_uppercase().to_string();
        }
    }
    "#".to_string()
}

/// Convert Chinese/Latin text into space-separated Pinyin sort key (e.g. "周杰伦" -> "Zhou Jie Lun").
pub fn to_pinyin_sort_key(text: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut latin_buf = String::new();

    for ch in text.trim().chars() {
        if let Some(py) = ch.to_pinyin() {
            if !latin_buf.is_empty() {
                parts.push(latin_buf.clone());
                latin_buf.clear();
            }
            let p = py.plain();
            let mut chars = p.chars();
            if let Some(first) = chars.next() {
                let cap = format!("{}{}", first.to_ascii_uppercase(), chars.as_str());
                parts.push(cap);
            }
        } else if ch.is_ascii_alphanumeric() {
            latin_buf.push(ch);
        } else if !latin_buf.is_empty() {
            parts.push(latin_buf.clone());
            latin_buf.clear();
        }
    }
    if !latin_buf.is_empty() {
        parts.push(latin_buf);
    }
    parts.join(" ")
}

/// Detect potential mojibake where GBK/Big5 bytes were decoded as ISO-8859-1.
pub fn looks_like_mojibake(text: &str) -> bool {
    text.chars().any(|c| ('\u{0080}'..='\u{00FF}').contains(&c))
}

pub fn repair_mojibake(text: &str, source_encoding: &str) -> Option<String> {
    if !looks_like_mojibake(text) {
        return None;
    }
    let bytes: Vec<u8> = text
        .chars()
        .filter_map(|c| {
            let code = c as u32;
            if code <= 0xFF {
                Some(code as u8)
            } else {
                None
            }
        })
        .collect();
    if bytes.is_empty() {
        return None;
    }
    let enc = match source_encoding.to_lowercase().as_str() {
        "big5" => BIG5,
        "shift_jis" | "sjis" => SHIFT_JIS,
        _ => GB18030,
    };
    let (decoded, _, had_errors) = enc.decode(&bytes);
    if had_errors {
        None
    } else {
        Some(decoded.into_owned())
    }
}

pub fn normalize_cjk_punctuation(text: &str) -> String {
    text.replace('（', " (")
        .replace('）', ")")
        .replace('【', " [")
        .replace('】', "]")
        .replace("  (", " (")
        .replace("  [", " [")
        .trim()
        .to_string()
}

pub fn detect_diagnostic_flags(t: &TrackRecord) -> Vec<String> {
    let mut flags = Vec::new();
    if t.cover_hash.is_none() && t.cover_data_url.is_none() {
        flags.push("missing_cover".to_string());
    }
    let lower_artist = t.artist.to_lowercase();
    if (lower_artist.contains("feat")
        || lower_artist.contains("ft.")
        || t.artist.contains('/')
        || t.artist.contains('、'))
        && t.album_artist.trim().is_empty()
    {
        flags.push("fragmented_album".to_string());
    }
    if looks_like_mojibake(&t.title)
        || looks_like_mojibake(&t.artist)
        || looks_like_mojibake(&t.album)
        || t.title.contains('（')
        || t.album.contains('（')
    {
        flags.push("encoding_issue".to_string());
    }
    if t.track_number.is_none() || t.year.trim().is_empty() {
        flags.push("missing_track_or_year".to_string());
    }
    if t.specs.md5_verified == "mismatch" {
        flags.push("md5_mismatch".to_string());
    }
    flags
}

/// Extract primary artist before feat./ft./slash/semicolon delimiters.
pub fn extract_primary_artist(artist: &str) -> String {
    let re = Regex::new(r"(?i)\s*(?:feat\.?|ft\.?|featuring|/|;|、|&)\s*.*$").unwrap();
    let cleaned = re.replace(artist.trim(), "");
    cleaned.trim().to_string()
}

/// Unify fragmented albums by inferring dominant AlbumArtist and cleaning Disc numbers.
pub fn plan_unify_fragmented_albums(tracks: &[TrackRecord]) -> Vec<StagedChange> {
    let mut by_album_dir: HashMap<String, Vec<&TrackRecord>> = HashMap::new();
    for t in tracks {
        let parent = Path::new(&t.file_path)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let album_key = format!("{}::{}", parent, t.album.trim().to_lowercase());
        by_album_dir.entry(album_key).or_default().push(t);
    }

    let mut staged = Vec::new();
    for (_key, group) in by_album_dir {
        let mut counts: HashMap<String, usize> = HashMap::new();
        for t in &group {
            let base = if !t.album_artist.trim().is_empty() {
                t.album_artist.trim().to_string()
            } else {
                extract_primary_artist(&t.artist)
            };
            if !base.is_empty() {
                *counts.entry(base).or_insert(0) += 1;
            }
        }
        let dominant_aa = counts
            .into_iter()
            .max_by_key(|(_, c)| *c)
            .map(|(name, _)| name)
            .unwrap_or_default();

        if dominant_aa.is_empty() {
            continue;
        }

        for t in group {
            if t.album_artist.trim() != dominant_aa {
                let mut patch = TagPatch::default();
                patch.album_artist = Some(dominant_aa.clone());
                if t.artist_sort.trim().is_empty() {
                    patch.artist_sort = Some(to_pinyin_sort_key(&dominant_aa));
                }
                staged.push(StagedChange {
                    track_id: t.id.clone(),
                    patch,
                    reason: format!("专辑歌手归并 → {dominant_aa}"),
                });
            }
        }
    }

    staged
}

/// Parse filenames using tokens like "%track% - %artist% - %title%".
pub fn parse_filename_pattern(file_name: &str, pattern: &str) -> Option<TagPatch> {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(file_name);

    let tokens = [
        ("%track%", r"(?P<track>\d{1,3})"),
        ("%disc%", r"(?P<disc>\d{1,2})"),
        ("%year%", r"(?P<year>\d{4})"),
        ("%artist%", r"(?P<artist>.+?)"),
        ("%album_artist%", r"(?P<album_artist>.+?)"),
        ("%album%", r"(?P<album>.+?)"),
        ("%title%", r"(?P<title>.+?)"),
    ];

    let mut regex_str = regex::escape(pattern);
    for (tok, cap) in tokens {
        regex_str = regex_str.replace(&regex::escape(tok), cap);
    }
    let full_re = Regex::new(&format!("^{regex_str}$")).ok()?;
    let caps = full_re.captures(stem)?;

    let mut patch = TagPatch::default();
    if let Some(m) = caps.name("track") {
        patch.track_number = Some(m.as_str().parse::<u32>().ok());
    }
    if let Some(m) = caps.name("disc") {
        patch.disc_number = Some(m.as_str().parse::<u32>().ok());
    }
    if let Some(m) = caps.name("year") {
        patch.year = Some(m.as_str().to_string());
    }
    if let Some(m) = caps.name("artist") {
        patch.artist = Some(m.as_str().trim().to_string());
    }
    if let Some(m) = caps.name("album_artist") {
        patch.album_artist = Some(m.as_str().trim().to_string());
    }
    if let Some(m) = caps.name("album") {
        patch.album = Some(m.as_str().trim().to_string());
    }
    if let Some(m) = caps.name("title") {
        patch.title = Some(m.as_str().trim().to_string());
    }

    Some(patch)
}
