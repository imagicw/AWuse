# AWuse

> **A + Muse** (with an inverted **M** forming the **W** waveform) — A high-precision, zero-AI-slop lossless music media library manager and batch metadata workstation built with **Tauri v2**, **Rust**, and **React 19**.

---

## Core Capabilities

- **Zero-Dependency Lossless Engine (Pure Rust)**: Powered by `lofty` and `symphonia` to read/write Vorbis Comments, MP4 `ilst` atoms, and embedded picture blocks across **FLAC**, **Apple Lossless (ALAC / `.m4a`)**, **AAC**, **MP3**, **WAV**, and **OGG** — with FLAC padding-aware fast updates and `STREAMINFO` MD5 integrity verification.
- **Dual Workspace Modes**:
  - **Media Library Mode**: Mounts local music directories into SQLite WAL + FTS5 with deduplicated cover art caching, Pinyin `A–Z` jump navigation, and smart diagnostics (missing cover, fragmented `feat.` albums, encoding issues, missing track/year, unorganized paths, MD5 mismatches).
  - **Staging Workspace**: Drag-and-drop newly downloaded `.flac` / `.m4a` folders, clean metadata, and archive cleanly into the main library.
- **Metadata-Driven Organization & Batch Engines**:
  - **Physical Directory Reorganizer**: Customizable path templates (e.g., `{AlbumArtist}/{Year} - {Album}/{TrackNumber} - {Title}.{ext}`) with companion file migration (`.lrc`, `.cue`, `.log`, `cover.jpg`), empty folder cleanup, and dry-run path diff preview.
  - **Fragmented Album & `feat.` Unifier**: Automatically normalizes `Album Artist` and multi-disc numbering (`DiscNumber`) so collaboration tracks stay grouped inside their album.
  - **Bidirectional Filename ⇄ Tag & Regex Engine**: Parse patterns like `%track% - %artist% - %title%` or run regex replacements across selected fields.
  - **CJK Cleaner & Sort Tag Generator**: Repair GBK/Big5/Shift-JIS mojibake to UTF-8, convert Traditional ⇄ Simplified Chinese, normalize full/half-width punctuation, and generate standard `ARTISTSORT` / `ALBUMSORT` tags.
  - **Multi-Source Online Scraper**: Search MusicBrainz, Apple iTunes HD cover art, NetEase Cloud Music, and QQ Music.
- **Staged Transaction Queue & Undo**: Every single-track or batch edit stages in memory with visual field diffs first, commits atomically via `Cmd+S`, and supports transaction rollback via `Cmd+Z`.
- **ADA Precision Interface**: Adaptive Light/Dark theme, macOS overlay titlebar integration, 1px hairline dividers, strict `tabular-nums` alignment, 150ms damped motion, and zero AI-slop gradients or vanity charts.

---

## Development & Build

### Prerequisites
- Node.js 20+ & `pnpm`
- Rust toolchain (`rustc` / `cargo`) for native desktop compilation

### Run Web / Binary Parser Workbench
```sh
pnpm install
pnpm dev
```
> Even in standalone browser mode, AWuse includes a client-side binary `.flac` and `.m4a` parser so you can drag and drop local lossless files directly into the workbench.

### Build Native Desktop App (`.app` / `.dmg`)
```sh
pnpm tauri dev
# or build production installers:
pnpm tauri build
```

See [docs/ARCHITECTURE_AND_DESIGN.md](docs/ARCHITECTURE_AND_DESIGN.md) for the complete SQLite FTS5 schema, state machine, and ADA token specifications.
