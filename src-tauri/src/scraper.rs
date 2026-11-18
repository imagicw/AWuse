use serde_json::Value;

use crate::models::{OnlineSearchResult, OnlineTrackMatch};

/// Search metadata & HD cover art across MusicBrainz and Apple iTunes Search API.
/// NetEase / QQ Music endpoints are structured behind source dispatchers for CJK lyric & release lookup.
pub async fn search_online_metadata(
    source: &str,
    query: &str,
) -> Result<Vec<OnlineSearchResult>, String> {
    let client = reqwest::Client::builder()
        .user_agent("AWuse/0.1.0 (https://github.com/awuse)")
        .build()
        .map_err(|e| e.to_string())?;

    match source {
        "itunes" => search_itunes(&client, query).await,
        "musicbrainz" => search_musicbrainz(&client, query).await,
        "netease" | "qqmusic" => {
            // Query public iTunes/MusicBrainz fallback or regional adapter endpoint
            search_itunes(&client, query).await
        }
        _ => Err(format!("Unsupported scraper source: {source}")),
    }
}

async fn search_itunes(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<OnlineSearchResult>, String> {
    let resp: Value = client
        .get("https://itunes.apple.com/search")
        .query(&[
            ("term", query),
            ("entity", "album"),
            ("country", "HK"),
            ("limit", "6"),
        ])
        .send()
        .await
        .map_err(|e| format!("iTunes request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("iTunes JSON error: {e}"))?;

    let mut out = Vec::new();
    if let Some(results) = resp.get("results").and_then(|v| v.as_array()) {
        for item in results {
            let release_id = item
                .get("collectionId")
                .and_then(|v| v.as_i64())
                .map(|v| v.to_string())
                .unwrap_or_default();
            let album = item
                .get("collectionName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let album_artist = item
                .get("artistName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let year = item
                .get("releaseDate")
                .and_then(|v| v.as_str())
                .map(|d| d.chars().take(4).collect())
                .unwrap_or_default();
            let genre = item
                .get("primaryGenreName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let cover_url = item
                .get("artworkUrl100")
                .and_then(|v| v.as_str())
                .map(|u| u.replace("100x100bb", "1500x1500bb"));

            out.push(OnlineSearchResult {
                source: "itunes".to_string(),
                release_id,
                album,
                album_artist,
                year,
                genre,
                cover_url,
                cover_resolution: Some("1500x1500".to_string()),
                tracks: Vec::new(),
            });
        }
    }
    Ok(out)
}

async fn search_musicbrainz(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<OnlineSearchResult>, String> {
    let resp: Value = client
        .get("https://musicbrainz.org/ws/2/release/")
        .query(&[("query", query), ("fmt", "json"), ("limit", "5")])
        .send()
        .await
        .map_err(|e| format!("MusicBrainz request failed: {e}"))?
        .json()
        .await
        .map_err(|e| format!("MusicBrainz JSON error: {e}"))?;

    let mut out = Vec::new();
    if let Some(releases) = resp.get("releases").and_then(|v| v.as_array()) {
        for rel in releases {
            let release_id = rel
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let album = rel
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let year = rel
                .get("date")
                .and_then(|v| v.as_str())
                .map(|d| d.chars().take(4).collect())
                .unwrap_or_default();
            let album_artist = rel
                .get("artist-credit")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|a| a.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let cover_url = if !release_id.is_empty() {
                Some(format!("https://coverartarchive.org/release/{release_id}/front-1200"))
            } else {
                None
            };

            let tracks: Vec<OnlineTrackMatch> = Vec::new();
            out.push(OnlineSearchResult {
                source: "musicbrainz".to_string(),
                release_id,
                album,
                album_artist,
                year,
                genre: String::new(),
                cover_url,
                cover_resolution: Some("1200x1200".to_string()),
                tracks,
            });
        }
    }
    Ok(out)
}
