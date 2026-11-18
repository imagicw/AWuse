use std::path::Path;
use std::sync::Mutex;

use rusqlite::{params, Connection};

use crate::models::{DiagnosticSummary, TrackRecord, TransactionItem, TransactionRecord};

pub struct LibraryDb {
    pub conn: Mutex<Connection>,
}

impl LibraryDb {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(db_path).map_err(|e| format!("SQLite open error: {e}"))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS library_roots (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                path        TEXT NOT NULL UNIQUE,
                label       TEXT NOT NULL,
                added_at    TEXT NOT NULL,
                last_scan   TEXT
            );

            CREATE TABLE IF NOT EXISTS covers (
                hash        TEXT PRIMARY KEY,
                mime_type   TEXT NOT NULL,
                width       INTEGER NOT NULL,
                height      INTEGER NOT NULL,
                byte_size   INTEGER NOT NULL,
                cache_path  TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id               TEXT PRIMARY KEY,
                workspace_mode   TEXT NOT NULL DEFAULT 'library',
                file_path        TEXT NOT NULL UNIQUE,
                file_name        TEXT NOT NULL,
                extension        TEXT NOT NULL,
                codec            TEXT NOT NULL,
                file_size        INTEGER NOT NULL,
                mtime_ms         INTEGER NOT NULL,
                title            TEXT NOT NULL DEFAULT '',
                artist           TEXT NOT NULL DEFAULT '',
                album_artist     TEXT NOT NULL DEFAULT '',
                album            TEXT NOT NULL DEFAULT '',
                year             TEXT NOT NULL DEFAULT '',
                genre            TEXT NOT NULL DEFAULT '',
                track_number     INTEGER,
                total_tracks     INTEGER,
                disc_number      INTEGER,
                total_discs      INTEGER,
                comment          TEXT NOT NULL DEFAULT '',
                lyrics           TEXT NOT NULL DEFAULT '',
                has_external_lrc INTEGER NOT NULL DEFAULT 0,
                artist_sort      TEXT NOT NULL DEFAULT '',
                album_sort       TEXT NOT NULL DEFAULT '',
                pinyin_initial   TEXT NOT NULL DEFAULT '#',
                sample_rate      INTEGER NOT NULL DEFAULT 44100,
                bit_depth        INTEGER NOT NULL DEFAULT 16,
                channels         INTEGER NOT NULL DEFAULT 2,
                bitrate_kbps     INTEGER NOT NULL DEFAULT 0,
                duration_ms      INTEGER NOT NULL DEFAULT 0,
                stream_md5       TEXT NOT NULL DEFAULT '',
                md5_verified     TEXT NOT NULL DEFAULT 'unknown',
                cover_hash       TEXT,
                cover_width      INTEGER DEFAULT 0,
                cover_height     INTEGER DEFAULT 0,
                cover_bytes      INTEGER DEFAULT 0,
                diag_flags       TEXT NOT NULL DEFAULT '[]'
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_album_group
                ON tracks(album_artist, album, disc_number, track_number);
            CREATE INDEX IF NOT EXISTS idx_tracks_pinyin
                ON tracks(pinyin_initial, artist_sort);

            CREATE VIRTUAL TABLE IF NOT EXISTS tracks_fts USING fts5(
                track_id UNINDEXED,
                title,
                artist,
                album_artist,
                album,
                genre,
                file_path,
                tokenize = 'unicode61'
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id          TEXT PRIMARY KEY,
                created_at  TEXT NOT NULL,
                summary     TEXT NOT NULL,
                item_count  INTEGER NOT NULL,
                reverted    INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS transaction_items (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                tx_id       TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                track_id    TEXT NOT NULL,
                op_type     TEXT NOT NULL,
                before_json TEXT NOT NULL,
                after_json  TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Schema init error: {e}"))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn upsert_tracks(&self, tracks: &[TrackRecord]) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO tracks (
                        id, workspace_mode, file_path, file_name, extension, codec, file_size, mtime_ms,
                        title, artist, album_artist, album, year, genre, track_number, total_tracks,
                        disc_number, total_discs, comment, lyrics, has_external_lrc,
                        artist_sort, album_sort, pinyin_initial,
                        sample_rate, bit_depth, channels, bitrate_kbps, duration_ms, stream_md5, md5_verified,
                        cover_hash, cover_width, cover_height, cover_bytes, diag_flags
                    ) VALUES (
                        ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8,
                        ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                        ?17, ?18, ?19, ?20, ?21,
                        ?22, ?23, ?24,
                        ?25, ?26, ?27, ?28, ?29, ?30, ?31,
                        ?32, ?33, ?34, ?35, ?36
                    )
                    ON CONFLICT(file_path) DO UPDATE SET
                        id = excluded.id,
                        workspace_mode = excluded.workspace_mode,
                        file_name = excluded.file_name,
                        extension = excluded.extension,
                        codec = excluded.codec,
                        file_size = excluded.file_size,
                        mtime_ms = excluded.mtime_ms,
                        title = excluded.title,
                        artist = excluded.artist,
                        album_artist = excluded.album_artist,
                        album = excluded.album,
                        year = excluded.year,
                        genre = excluded.genre,
                        track_number = excluded.track_number,
                        total_tracks = excluded.total_tracks,
                        disc_number = excluded.disc_number,
                        total_discs = excluded.total_discs,
                        comment = excluded.comment,
                        lyrics = excluded.lyrics,
                        has_external_lrc = excluded.has_external_lrc,
                        artist_sort = excluded.artist_sort,
                        album_sort = excluded.album_sort,
                        pinyin_initial = excluded.pinyin_initial,
                        sample_rate = excluded.sample_rate,
                        bit_depth = excluded.bit_depth,
                        channels = excluded.channels,
                        bitrate_kbps = excluded.bitrate_kbps,
                        duration_ms = excluded.duration_ms,
                        stream_md5 = excluded.stream_md5,
                        md5_verified = excluded.md5_verified,
                        cover_hash = excluded.cover_hash,
                        cover_width = excluded.cover_width,
                        cover_height = excluded.cover_height,
                        cover_bytes = excluded.cover_bytes,
                        diag_flags = excluded.diag_flags",
                )
                .map_err(|e| e.to_string())?;

            let mut fts_del = tx
                .prepare("DELETE FROM tracks_fts WHERE track_id = ?1")
                .map_err(|e| e.to_string())?;
            let mut fts_ins = tx
                .prepare(
                    "INSERT INTO tracks_fts (track_id, title, artist, album_artist, album, genre, file_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                )
                .map_err(|e| e.to_string())?;

            for t in tracks {
                let diag_json = serde_json::to_string(&t.diag_flags).unwrap_or_else(|_| "[]".into());
                stmt.execute(params![
                    t.id,
                    t.workspace_mode,
                    t.file_path,
                    t.file_name,
                    t.extension,
                    t.specs.codec,
                    t.file_size as i64,
                    t.mtime_ms,
                    t.title,
                    t.artist,
                    t.album_artist,
                    t.album,
                    t.year,
                    t.genre,
                    t.track_number,
                    t.total_tracks,
                    t.disc_number,
                    t.total_discs,
                    t.comment,
                    t.lyrics,
                    if t.has_external_lrc { 1 } else { 0 },
                    t.artist_sort,
                    t.album_sort,
                    t.pinyin_initial,
                    t.specs.sample_rate,
                    t.specs.bit_depth,
                    t.specs.channels,
                    t.specs.bitrate_kbps,
                    t.specs.duration_ms as i64,
                    t.specs.stream_md5,
                    t.specs.md5_verified,
                    t.cover_hash,
                    t.cover_width,
                    t.cover_height,
                    t.cover_bytes as i64,
                    diag_json,
                ])
                .map_err(|e| e.to_string())?;

                fts_del.execute(params![t.id]).map_err(|e| e.to_string())?;
                fts_ins
                    .execute(params![
                        t.id,
                        t.title,
                        t.artist,
                        t.album_artist,
                        t.album,
                        t.genre,
                        t.file_path
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())
    }

    pub fn query_tracks(&self, workspace_mode: &str, search_query: Option<&str>) -> Result<Vec<TrackRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let base_sql = if let Some(q) = search_query.filter(|s| !s.trim().is_empty()) {
            let escaped = q.trim().replace('"', "\"\"");
            let match_expr = format!("\"{escaped}\"*");
            let mut stmt = conn
                .prepare(
                    "SELECT t.id, t.workspace_mode, t.file_path, t.file_name, t.extension, t.codec, t.file_size, t.mtime_ms,
                            t.title, t.artist, t.album_artist, t.album, t.year, t.genre, t.track_number, t.total_tracks,
                            t.disc_number, t.total_discs, t.comment, t.lyrics, t.has_external_lrc,
                            t.artist_sort, t.album_sort, t.pinyin_initial,
                            t.sample_rate, t.bit_depth, t.channels, t.bitrate_kbps, t.duration_ms, t.stream_md5, t.md5_verified,
                            t.cover_hash, t.cover_width, t.cover_height, t.cover_bytes, t.diag_flags
                     FROM tracks t
                     JOIN tracks_fts f ON t.id = f.track_id
                     WHERE t.workspace_mode = ?1 AND tracks_fts MATCH ?2
                     ORDER BY t.pinyin_initial, t.album_artist, t.album, t.disc_number, t.track_number",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![workspace_mode, match_expr], map_track_row)
                .map_err(|e| e.to_string())?;
            return rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string());
        } else {
            "SELECT id, workspace_mode, file_path, file_name, extension, codec, file_size, mtime_ms,
                    title, artist, album_artist, album, year, genre, track_number, total_tracks,
                    disc_number, total_discs, comment, lyrics, has_external_lrc,
                    artist_sort, album_sort, pinyin_initial,
                    sample_rate, bit_depth, channels, bitrate_kbps, duration_ms, stream_md5, md5_verified,
                    cover_hash, cover_width, cover_height, cover_bytes, diag_flags
             FROM tracks
             WHERE workspace_mode = ?1
             ORDER BY pinyin_initial, album_artist, album, disc_number, track_number"
        };

        let mut stmt = conn.prepare(base_sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![workspace_mode], map_track_row)
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn record_transaction(&self, tx_rec: &TransactionRecord) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO transactions (id, created_at, summary, item_count, reverted) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                tx_rec.id,
                tx_rec.created_at,
                tx_rec.summary,
                tx_rec.item_count as i64,
                if tx_rec.reverted { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;

        for item in &tx_rec.items {
            tx.execute(
                "INSERT INTO transaction_items (tx_id, track_id, op_type, before_json, after_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![tx_rec.id, item.track_id, item.op_type, item.before_json, item.after_json],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn list_transactions(&self) -> Result<Vec<TransactionRecord>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, created_at, summary, item_count, reverted FROM transactions ORDER BY created_at DESC LIMIT 50")
            .map_err(|e| e.to_string())?;
        let txs = stmt
            .query_map([], |row| {
                Ok(TransactionRecord {
                    id: row.get(0)?,
                    created_at: row.get(1)?,
                    summary: row.get(2)?,
                    item_count: row.get::<_, i64>(3)? as usize,
                    reverted: row.get::<_, i64>(4)? != 0,
                    items: Vec::new(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut out = Vec::with_capacity(txs.len());
        for mut t in txs {
            let mut item_stmt = conn
                .prepare("SELECT track_id, op_type, before_json, after_json FROM transaction_items WHERE tx_id = ?1")
                .map_err(|e| e.to_string())?;
            let items = item_stmt
                .query_map(params![t.id], |r| {
                    Ok(TransactionItem {
                        track_id: r.get(0)?,
                        op_type: r.get(1)?,
                        before_json: r.get(2)?,
                        after_json: r.get(3)?,
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            t.items = items;
            out.push(t);
        }
        Ok(out)
    }

    pub fn compute_diagnostics(&self, workspace_mode: &str) -> Result<DiagnosticSummary, String> {
        let tracks = self.query_tracks(workspace_mode, None)?;
        let mut summary = DiagnosticSummary {
            total_tracks: tracks.len(),
            missing_cover: 0,
            fragmented_album: 0,
            encoding_or_cjk_issue: 0,
            missing_track_or_year: 0,
            unorganized_path: 0,
            md5_failed: 0,
        };
        for t in tracks {
            for f in t.diag_flags {
                match f.as_str() {
                    "missing_cover" => summary.missing_cover += 1,
                    "fragmented_album" => summary.fragmented_album += 1,
                    "encoding_issue" => summary.encoding_or_cjk_issue += 1,
                    "missing_track_or_year" => summary.missing_track_or_year += 1,
                    "unorganized_path" => summary.unorganized_path += 1,
                    "md5_mismatch" => summary.md5_failed += 1,
                    _ => {}
                }
            }
        }
        Ok(summary)
    }
}

fn map_track_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TrackRecord> {
    let diag_str: String = row.get(35)?;
    let diag_flags: Vec<String> = serde_json::from_str(&diag_str).unwrap_or_default();
    Ok(TrackRecord {
        id: row.get(0)?,
        workspace_mode: row.get(1)?,
        file_path: row.get(2)?,
        file_name: row.get(3)?,
        extension: row.get(4)?,
        specs: crate::models::AudioSpecs {
            codec: row.get(5)?,
            sample_rate: row.get(24)?,
            bit_depth: row.get(25)?,
            channels: row.get(26)?,
            bitrate_kbps: row.get(27)?,
            duration_ms: row.get::<_, i64>(28)? as u64,
            stream_md5: row.get(29)?,
            md5_verified: row.get(30)?,
        },
        file_size: row.get::<_, i64>(6)? as u64,
        mtime_ms: row.get(7)?,
        title: row.get(8)?,
        artist: row.get(9)?,
        album_artist: row.get(10)?,
        album: row.get(11)?,
        year: row.get(12)?,
        genre: row.get(13)?,
        track_number: row.get(14)?,
        total_tracks: row.get(15)?,
        disc_number: row.get(16)?,
        total_discs: row.get(17)?,
        comment: row.get(18)?,
        lyrics: row.get(19)?,
        has_external_lrc: row.get::<_, i64>(20)? != 0,
        artist_sort: row.get(21)?,
        album_sort: row.get(22)?,
        pinyin_initial: row.get(23)?,
        cover_hash: row.get(31)?,
        cover_width: row.get(32)?,
        cover_height: row.get(33)?,
        cover_bytes: row.get::<_, i64>(34)? as u64,
        cover_data_url: None,
        diag_flags,
    })
}
