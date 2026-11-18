use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use lofty::config::WriteOptions;
use lofty::file::{AudioFile, FileType, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey, ItemValue, Tag, TagItem, TagType};
use md5::{Digest as Md5Digest, Md5};
use sha2::Sha256;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::batch_tools::{compute_pinyin_initial, detect_diagnostic_flags};
use crate::models::{AudioSpecs, TagPatch, TrackRecord};

pub fn is_supported_audio(path: &Path) -> bool {
    match path.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()) {
        Some(ext) => matches!(ext.as_str(), "flac" | "m4a" | "mp3" | "wav" | "ogg" | "alac"),
        None => false,
    }
}

/// Parse FLAC STREAMINFO header directly so we get exact 16-byte stream MD5 and bit depth.
pub fn parse_flac_streaminfo_md5(path: &Path) -> Option<String> {
    let mut f = File::open(path).ok()?;
    let mut magic = [0u8; 4];
    f.read_exact(&mut magic).ok()?;
    if &magic != b"fLaC" {
        return None;
    }

    let mut header = [0u8; 4];
    f.read_exact(&mut header).ok()?;
    let block_type = header[0] & 0x7F;
    let block_len = ((header[1] as usize) << 16) | ((header[2] as usize) << 8) | (header[3] as usize);
    if block_type != 0 || block_len < 34 {
        return None;
    }

    let mut info = [0u8; 34];
    f.read_exact(&mut info).ok()?;
    Some(hex::encode(&info[18..34]))
}

/// Read metadata, audio stream parameters, and cover metadata using lofty.
pub fn read_track_metadata(
    path: &Path,
    workspace_mode: &str,
    cover_cache_dir: Option<&Path>,
) -> Result<TrackRecord, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Failed to stat {}: {e}", path.display()))?;
    let file_size = meta.len();
    let mtime_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?
        .read()
        .map_err(|e| format!("Failed to parse {}: {e}", path.display()))?;

    let props = tagged_file.properties();
    let file_type = tagged_file.file_type();
    let extension = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let codec = match file_type {
        FileType::Flac => "FLAC".to_string(),
        FileType::Mp4 => {
            if props.bit_depth().unwrap_or(0) > 0 {
                "ALAC".to_string()
            } else {
                "AAC".to_string()
            }
        }
        FileType::Mpeg => "MP3".to_string(),
        FileType::Wav => "PCM".to_string(),
        FileType::Vorbis => "OGG".to_string(),
        _ => extension.to_uppercase(),
    };

    let stream_md5 = if file_type == FileType::Flac {
        parse_flac_streaminfo_md5(path).unwrap_or_default()
    } else {
        String::new()
    };

    let md5_verified = if file_type == FileType::Flac {
        if stream_md5.is_empty() || stream_md5.chars().all(|c| c == '0') {
            "unknown".to_string()
        } else {
            "unverified".to_string()
        }
    } else {
        "unsupported".to_string()
    };

    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let mut title = String::new();
    let mut artist = String::new();
    let mut album_artist = String::new();
    let mut album = String::new();
    let mut year = String::new();
    let mut genre = String::new();
    let mut track_number = None;
    let mut total_tracks = None;
    let mut disc_number = None;
    let mut total_discs = None;
    let mut comment = String::new();
    let mut lyrics = String::new();
    let mut artist_sort = String::new();
    let mut album_sort = String::new();

    let mut cover_hash = None;
    let mut cover_bytes = 0u64;

    if let Some(t) = tag {
        title = t.title().map(|s| s.to_string()).unwrap_or_default();
        artist = t.artist().map(|s| s.to_string()).unwrap_or_default();
        album = t.album().map(|s| s.to_string()).unwrap_or_default();
        year = t.year().map(|y| y.to_string()).unwrap_or_default();
        genre = t.genre().map(|s| s.to_string()).unwrap_or_default();
        track_number = t.track();
        total_tracks = t.track_total();
        disc_number = t.disk();
        total_discs = t.disk_total();
        comment = t.comment().map(|s| s.to_string()).unwrap_or_default();

        album_artist = t
            .get_string(&ItemKey::AlbumArtist)
            .unwrap_or_default()
            .to_string();
        lyrics = t
            .get_string(&ItemKey::Lyrics)
            .unwrap_or_default()
            .to_string();
        artist_sort = t
            .get_string(&ItemKey::TrackArtistSortOrder)
            .or_else(|| t.get_string(&ItemKey::AlbumArtistSortOrder))
            .unwrap_or_default()
            .to_string();
        album_sort = t
            .get_string(&ItemKey::AlbumTitleSortOrder)
            .unwrap_or_default()
            .to_string();

        if let Some(pic) = t.pictures().first() {
            let data = pic.data();
            cover_bytes = data.len() as u64;
            let mut hasher = Sha256::new();
            hasher.update(data);
            let hash = hex::encode(hasher.finalize());
            if let Some(cache_dir) = cover_cache_dir {
                let _ = fs::create_dir_all(cache_dir);
                let ext = match pic.mime_type() {
                    Some(MimeType::Png) => "png",
                    Some(MimeType::Unknown(s)) if s == "image/webp" => "webp",
                    _ => "jpg",
                };
                let target = cache_dir.join(format!("{hash}.{ext}"));
                if !target.exists() {
                    let _ = fs::write(&target, data);
                }
            }
            cover_hash = Some(hash);
        }
    }

    let lrc_path = path.with_extension("lrc");
    let has_external_lrc = lrc_path.exists();
    if lyrics.is_empty() && has_external_lrc {
        if let Ok(ext_lrc) = fs::read_to_string(&lrc_path) {
            lyrics = ext_lrc;
        }
    }

    let file_path = path.to_string_lossy().to_string();
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let id = {
        let mut h = Sha256::new();
        h.update(file_path.as_bytes());
        hex::encode(&h.finalize()[..12])
    };

    let primary_artist_for_sort = if !album_artist.is_empty() {
        &album_artist
    } else {
        &artist
    };
    let pinyin_initial = compute_pinyin_initial(primary_artist_for_sort);

    let specs = AudioSpecs {
        codec,
        sample_rate: props.sample_rate().unwrap_or(44100),
        bit_depth: props.bit_depth().unwrap_or(16),
        channels: props.channels().unwrap_or(2),
        bitrate_kbps: props.audio_bitrate().unwrap_or(0),
        duration_ms: props.duration().as_millis() as u64,
        stream_md5,
        md5_verified,
    };

    let mut record = TrackRecord {
        id,
        workspace_mode: workspace_mode.to_string(),
        file_path,
        file_name,
        extension,
        file_size,
        mtime_ms,
        title,
        artist,
        album_artist,
        album,
        year,
        genre,
        track_number,
        total_tracks,
        disc_number,
        total_discs,
        comment,
        lyrics,
        has_external_lrc,
        artist_sort,
        album_sort,
        pinyin_initial,
        specs,
        cover_hash,
        cover_width: 0,
        cover_height: 0,
        cover_bytes,
        cover_data_url: None,
        diag_flags: Vec::new(),
    };

    record.diag_flags = detect_diagnostic_flags(&record);
    Ok(record)
}

/// Apply a TagPatch to a physical audio file using lofty (in-place padding update when available).
pub fn write_tag_patch_to_file(path: &Path, patch: &TagPatch) -> Result<(), String> {
    let mut tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open {}: {e}", path.display()))?
        .read()
        .map_err(|e| format!("Failed to read {}: {e}", path.display()))?;

    let tag_type = tagged_file.primary_tag_type();
    if tagged_file.primary_tag().is_none() {
        let fallback_type = match tagged_file.file_type() {
            FileType::Flac => TagType::VorbisComments,
            FileType::Mp4 => TagType::Mp4Ilst,
            FileType::Mpeg => TagType::Id3v2,
            _ => tag_type,
        };
        tagged_file.insert_tag(Tag::new(fallback_type));
    }

    let tag = tagged_file
        .primary_tag_mut()
        .ok_or_else(|| "Unable to acquire writable tag container".to_string())?;

    if let Some(v) = &patch.title {
        tag.set_title(v.clone());
    }
    if let Some(v) = &patch.artist {
        tag.set_artist(v.clone());
    }
    if let Some(v) = &patch.album {
        tag.set_album(v.clone());
    }
    if let Some(v) = &patch.genre {
        tag.set_genre(v.clone());
    }
    if let Some(v) = &patch.comment {
        tag.set_comment(v.clone());
    }
    if let Some(v) = &patch.year {
        if let Ok(y) = v.trim().parse::<u32>() {
            tag.set_year(y);
        }
    }
    if let Some(opt_t) = patch.track_number {
        match opt_t {
            Some(n) => tag.set_track(n),
            None => tag.remove_track(),
        }
    }
    if let Some(opt_tt) = patch.total_tracks {
        match opt_tt {
            Some(n) => tag.set_track_total(n),
            None => tag.remove_track_total(),
        }
    }
    if let Some(opt_d) = patch.disc_number {
        match opt_d {
            Some(n) => tag.set_disk(n),
            None => tag.remove_disk(),
        }
    }
    if let Some(opt_td) = patch.total_discs {
        match opt_td {
            Some(n) => tag.set_disk_total(n),
            None => tag.remove_disk_total(),
        }
    }
    if let Some(v) = &patch.album_artist {
        tag.insert(TagItem::new(
            ItemKey::AlbumArtist,
            ItemValue::Text(v.clone()),
        ));
    }
    if let Some(v) = &patch.lyrics {
        tag.insert(TagItem::new(ItemKey::Lyrics, ItemValue::Text(v.clone())));
    }
    if let Some(v) = &patch.artist_sort {
        tag.insert(TagItem::new(
            ItemKey::TrackArtistSortOrder,
            ItemValue::Text(v.clone()),
        ));
        tag.insert(TagItem::new(
            ItemKey::AlbumArtistSortOrder,
            ItemValue::Text(v.clone()),
        ));
    }
    if let Some(v) = &patch.album_sort {
        tag.insert(TagItem::new(
            ItemKey::AlbumTitleSortOrder,
            ItemValue::Text(v.clone()),
        ));
    }

    if let Some(data_url) = &patch.cover_data_url {
        if let Some((mime, bytes)) = decode_data_url_image(data_url) {
            let pic = Picture::new_unchecked(PictureType::CoverFront, Some(mime), None, bytes);
            tag.remove_picture_type(PictureType::CoverFront);
            tag.push_picture(pic);
        }
    }

    // Preserve FLAC padding for fast in-place writes
    let write_opts = WriteOptions::default().preferred_padding(4096);
    tagged_file
        .save_to_path(path, write_opts)
        .map_err(|e| format!("Failed saving tags to {}: {e}", path.display()))?;

    Ok(())
}

fn decode_data_url_image(data_url: &str) -> Option<(MimeType, Vec<u8>)> {
    let (header, payload) = data_url.split_once(",")?;
    let mime = if header.contains("image/png") {
        MimeType::Png
    } else if header.contains("image/webp") {
        MimeType::Unknown("image/webp".to_string())
    } else {
        MimeType::Jpeg
    };
    let bytes = base64_decode(payload)?;
    Some((mime, bytes))
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[i8; 128] = &[
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
        52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,
        -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
        15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
        -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
        41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
    ];
    let mut out = Vec::with_capacity(input.len() * 3 / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in input.bytes() {
        if b == b'=' || b.is_ascii_whitespace() {
            continue;
        }
        if b >= 128 {
            return None;
        }
        let val = TABLE[b as usize];
        if val < 0 {
            return None;
        }
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Some(out)
}

/// Full lossless audio stream decode + FLAC STREAMINFO MD5 integrity verification.
pub fn verify_flac_md5_integrity(path: &Path) -> Result<(String, String), String> {
    let expected = parse_flac_streaminfo_md5(path)
        .ok_or_else(|| "Not a valid FLAC file or missing STREAMINFO".to_string())?;
    if expected.chars().all(|c| c == '0') {
        return Ok(("unknown".to_string(), expected));
    }

    let file = File::open(path).map_err(|e| format!("Failed to open {}: {e}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("flac");

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Symphonia probe failed: {e}"))?;

    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let track_id = track.id;
    let bits_per_sample = track.codec_params.bits_per_sample.unwrap_or(16);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("Decoder init failed: {e}"))?;

    let mut hasher = Md5::new();
    let mut pcm_bytes = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(pkt) => pkt,
            Err(SymphoniaError::IoError(err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => continue,
            Err(e) => return Err(format!("Read packet error: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|e| format!("Decode error: {e}"))?;

        let spec = *decoded.spec();
        let mut sbuf = SampleBuffer::<i32>::new(decoded.capacity() as u64, spec);
        sbuf.copy_interleaved_ref(decoded);
        pcm_bytes.clear();

        let shift = 32 - bits_per_sample.min(24);
        for &sample in sbuf.samples() {
            let raw = sample >> shift;
            match bits_per_sample {
                8 => pcm_bytes.push((raw & 0xFF) as u8),
                16 => pcm_bytes.extend_from_slice(&(raw as i16).to_le_bytes()),
                24 => {
                    let b = raw.to_le_bytes();
                    pcm_bytes.extend_from_slice(&b[0..3]);
                }
                _ => pcm_bytes.extend_from_slice(&raw.to_le_bytes()),
            }
        }
        hasher.update(&pcm_bytes);
    }

    let computed = hex::encode(hasher.finalize());
    let status = if computed == expected {
        "valid".to_string()
    } else {
        "mismatch".to_string()
    };
    Ok((status, computed))
}

#[allow(dead_code)]
fn _seek_helper(f: &mut File, pos: u64) -> std::io::Result<u64> {
    f.seek(SeekFrom::Start(pos))
}
