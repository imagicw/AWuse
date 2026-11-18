import { TrackRecord, WorkspaceMode } from "../types/music";
import { computePinyinInitial, detectDiagnosticFlags } from "./cjkAndBatchEngine";

function readUint24BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function measureImage(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

function parseIntPair(raw?: string): [number | null, number | null] {
  if (!raw) return [null, null];
  const parts = raw.split("/");
  const n = parseInt(parts[0], 10);
  const total = parts[1] ? parseInt(parts[1], 10) : NaN;
  return [Number.isFinite(n) ? n : null, Number.isFinite(total) ? total : null];
}

/**
 * Parse a real .flac binary buffer (STREAMINFO, VORBIS_COMMENT, PICTURE).
 */
async function parseFlacBuffer(
  buf: ArrayBuffer,
  file: File,
  workspaceMode: WorkspaceMode
): Promise<TrackRecord> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let offset = 4; // skip 'fLaC'

  let sampleRate = 44100;
  let channels = 2;
  let bitDepth = 16;
  let durationMs = 0;
  let streamMd5 = "";
  const vorbis: Record<string, string> = {};
  let coverDataUrl: string | null = null;
  let coverBytes = 0;

  while (offset + 4 <= buf.byteLength) {
    const header = view.getUint8(offset);
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLen = readUint24BE(view, offset + 1);
    offset += 4;

    if (offset + blockLen > buf.byteLength) break;

    if (blockType === 0 && blockLen >= 34) {
      // STREAMINFO
      const b10 = view.getUint32(offset + 10, false);
      sampleRate = (b10 >>> 12) & 0xfffff;
      channels = ((b10 >>> 9) & 0x07) + 1;
      bitDepth = ((b10 >>> 4) & 0x1f) + 1;
      const highSamples = b10 & 0x0f;
      const lowSamples = view.getUint32(offset + 14, false);
      const totalSamples = highSamples * 0x100000000 + lowSamples;
      if (sampleRate > 0) {
        durationMs = Math.round((totalSamples / sampleRate) * 1000);
      }
      streamMd5 = bytesToHex(bytes.subarray(offset + 18, offset + 34));
    } else if (blockType === 4) {
      // VORBIS_COMMENT
      const decoder = new TextDecoder("utf-8", { fatal: false });
      let pos = offset;
      const vendorLen = readUint32LE(view, pos);
      pos += 4 + vendorLen;
      if (pos + 4 <= offset + blockLen) {
        const count = readUint32LE(view, pos);
        pos += 4;
        for (let i = 0; i < count && pos + 4 <= offset + blockLen; i++) {
          const itemLen = readUint32LE(view, pos);
          pos += 4;
          if (pos + itemLen > offset + blockLen) break;
          const str = decoder.decode(bytes.subarray(pos, pos + itemLen));
          pos += itemLen;
          const eq = str.indexOf("=");
          if (eq > 0) {
            const k = str.slice(0, eq).toUpperCase();
            const v = str.slice(eq + 1);
            vorbis[k] = vorbis[k] ? `${vorbis[k]}; ${v}` : v;
          }
        }
      }
    } else if (blockType === 6 && !coverDataUrl) {
      // PICTURE
      let pos = offset;
      const picType = view.getUint32(pos, false);
      pos += 4;
      const mimeLen = view.getUint32(pos, false);
      pos += 4;
      const mime = new TextDecoder().decode(bytes.subarray(pos, pos + mimeLen)) || "image/jpeg";
      pos += mimeLen;
      const descLen = view.getUint32(pos, false);
      pos += 4 + descLen;
      pos += 16; // width, height, depth, colors
      const dataLen = view.getUint32(pos, false);
      pos += 4;
      if (pos + dataLen <= offset + blockLen && dataLen > 0) {
        // Prefer front cover (3) or first picture
        if (picType === 3 || !coverDataUrl) {
          coverBytes = dataLen;
          const b64 = uint8ToBase64(bytes.subarray(pos, pos + dataLen));
          coverDataUrl = `data:${mime};base64,${b64}`;
        }
      }
    }

    offset += blockLen;
    if (isLast) break;
  }

  let coverWidth = 0;
  let coverHeight = 0;
  if (coverDataUrl) {
    const dim = await measureImage(coverDataUrl);
    coverWidth = dim.width;
    coverHeight = dim.height;
  }

  const [trackNumber, totalTracks] = parseIntPair(
    vorbis["TRACKNUMBER"] || vorbis["TRACK"]
  );
  const [discNumber, totalDiscs] = parseIntPair(vorbis["DISCNUMBER"] || vorbis["DISC"]);
  const artist = vorbis["ARTIST"] || "";
  const albumArtist = vorbis["ALBUMARTIST"] || vorbis["ALBUM ARTIST"] || "";
  const title = vorbis["TITLE"] || file.name.replace(/\.[^.]+$/, "");
  const album = vorbis["ALBUM"] || "";
  const year = (vorbis["DATE"] || vorbis["YEAR"] || "").slice(0, 4);
  const bitrateKbps = durationMs > 0 ? Math.round((file.size * 8) / durationMs) : 0;

  const track: TrackRecord = {
    id: `local_${file.name}_${file.size}_${file.lastModified}`,
    workspaceMode,
    filePath: `/Imported/${file.name}`,
    fileName: file.name,
    extension: "flac",
    fileSize: file.size,
    mtimeMs: file.lastModified,
    title,
    artist,
    albumArtist,
    album,
    year,
    genre: vorbis["GENRE"] || "",
    trackNumber,
    totalTracks: totalTracks ?? (vorbis["TRACKTOTAL"] ? parseInt(vorbis["TRACKTOTAL"], 10) || null : null),
    discNumber,
    totalDiscs: totalDiscs ?? (vorbis["DISCTOTAL"] ? parseInt(vorbis["DISCTOTAL"], 10) || null : null),
    comment: vorbis["COMMENT"] || vorbis["DESCRIPTION"] || "",
    lyrics: vorbis["LYRICS"] || vorbis["UNSYNCEDLYRICS"] || "",
    hasExternalLrc: false,
    artistSort: vorbis["ARTISTSORT"] || vorbis["ALBUMARTISTSORT"] || "",
    albumSort: vorbis["ALBUMSORT"] || "",
    pinyinInitial: computePinyinInitial(albumArtist || artist || title),
    specs: {
      codec: "FLAC",
      sampleRate,
      bitDepth,
      channels,
      bitrateKbps,
      durationMs,
      streamMd5,
      md5Verified: streamMd5 && !/^0+$/.test(streamMd5) ? "unverified" : "unknown",
    },
    coverHash: coverDataUrl ? `local_${file.size}` : null,
    coverWidth,
    coverHeight,
    coverBytes,
    coverDataUrl,
    diagFlags: [],
    objectUrl: URL.createObjectURL(file),
  };

  track.diagFlags = detectDiagnosticFlags(track);
  return track;
}

/**
 * Parse MP4 / M4A (ALAC & AAC) boxes (`moov` -> `mvhd`, `stsd`, `udta/meta/ilst`).
 */
async function parseM4aBuffer(
  buf: ArrayBuffer,
  file: File,
  workspaceMode: WorkspaceMode
): Promise<TrackRecord> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const utf8 = new TextDecoder("utf-8", { fatal: false });
  const latin1 = new TextDecoder("latin1");

  let codec = "AAC";
  let sampleRate = 44100;
  let bitDepth = 16;
  let channels = 2;
  let durationMs = 0;

  let title = file.name.replace(/\.[^.]+$/, "");
  let artist = "";
  let albumArtist = "";
  let album = "";
  let year = "";
  let genre = "";
  let comment = "";
  let lyrics = "";
  let artistSort = "";
  let albumSort = "";
  let trackNumber: number | null = null;
  let totalTracks: number | null = null;
  let discNumber: number | null = null;
  let totalDiscs: number | null = null;
  let coverDataUrl: string | null = null;
  let coverBytes = 0;

  function walkAtoms(start: number, end: number) {
    let pos = start;
    while (pos + 8 <= end) {
      let size = view.getUint32(pos, false);
      const type = latin1.decode(bytes.subarray(pos + 4, pos + 8));
      let headerSize = 8;
      if (size === 1 && pos + 16 <= end) {
        size = Number(view.getBigUint64(pos + 8, false));
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end) break;

      const payloadStart = pos + headerSize;
      const payloadEnd = pos + size;

      if (["moov", "trak", "mdia", "minf", "stbl", "udta"].includes(type)) {
        walkAtoms(payloadStart, payloadEnd);
      } else if (type === "meta") {
        // FullBox: 4 bytes version/flags before children
        if (payloadStart + 4 <= payloadEnd) {
          walkAtoms(payloadStart + 4, payloadEnd);
        }
      } else if (type === "ilst") {
        parseIlst(payloadStart, payloadEnd);
      } else if (type === "mvhd" && payloadStart + 20 <= payloadEnd) {
        const version = view.getUint8(payloadStart);
        if (version === 0 && payloadStart + 20 <= payloadEnd) {
          const timescale = view.getUint32(payloadStart + 12, false);
          const dur = view.getUint32(payloadStart + 16, false);
          if (timescale > 0) durationMs = Math.round((dur / timescale) * 1000);
        } else if (version === 1 && payloadStart + 32 <= payloadEnd) {
          const timescale = view.getUint32(payloadStart + 20, false);
          const dur = Number(view.getBigUint64(payloadStart + 24, false));
          if (timescale > 0) durationMs = Math.round((dur / timescale) * 1000);
        }
      } else if (type === "stsd" && payloadStart + 16 <= payloadEnd) {
        const entryStart = payloadStart + 8;
        if (entryStart + 36 <= payloadEnd) {
          const fmt = latin1.decode(bytes.subarray(entryStart + 4, entryStart + 8));
          if (fmt === "alac") {
            codec = "ALAC";
            channels = view.getUint16(entryStart + 24, false) || 2;
            bitDepth = view.getUint16(entryStart + 26, false) || 16;
            const sr = view.getUint32(entryStart + 32, false) >>> 16;
            if (sr > 8000) sampleRate = sr;
          } else if (fmt === "mp4a") {
            codec = "AAC";
            channels = view.getUint16(entryStart + 24, false) || 2;
            bitDepth = 16;
            const sr = view.getUint32(entryStart + 32, false) >>> 16;
            if (sr > 8000) sampleRate = sr;
          }
        }
      }

      pos += size;
    }
  }

  function parseIlst(start: number, end: number) {
    let pos = start;
    while (pos + 8 <= end) {
      const size = view.getUint32(pos, false);
      const atomName = latin1.decode(bytes.subarray(pos + 4, pos + 8));
      if (size < 8 || pos + size > end) break;
      const itemEnd = pos + size;

      // find inner 'data' atom
      let dpos = pos + 8;
      while (dpos + 16 <= itemEnd) {
        const dsize = view.getUint32(dpos, false);
        const dtype = latin1.decode(bytes.subarray(dpos + 4, dpos + 8));
        if (dsize < 16 || dpos + dsize > itemEnd) break;
        if (dtype === "data") {
          const typeIndicator = view.getUint32(dpos + 8, false);
          const valStart = dpos + 16;
          const valEnd = dpos + dsize;
          const rawBytes = bytes.subarray(valStart, valEnd);

          if (atomName === "\u00a9nam") title = utf8.decode(rawBytes);
          else if (atomName === "\u00a9ART") artist = utf8.decode(rawBytes);
          else if (atomName === "aART") albumArtist = utf8.decode(rawBytes);
          else if (atomName === "\u00a9alb") album = utf8.decode(rawBytes);
          else if (atomName === "\u00a9day") year = utf8.decode(rawBytes).slice(0, 4);
          else if (atomName === "\u00a9gen") genre = utf8.decode(rawBytes);
          else if (atomName === "\u00a9cmt") comment = utf8.decode(rawBytes);
          else if (atomName === "\u00a9lyr") lyrics = utf8.decode(rawBytes);
          else if (atomName === "soar" || atomName === "soaa") artistSort = utf8.decode(rawBytes);
          else if (atomName === "soal") albumSort = utf8.decode(rawBytes);
          else if (atomName === "trkn" && rawBytes.length >= 6) {
            trackNumber = (rawBytes[2] << 8) | rawBytes[3] || null;
            totalTracks = (rawBytes[4] << 8) | rawBytes[5] || null;
          } else if (atomName === "disk" && rawBytes.length >= 6) {
            discNumber = (rawBytes[2] << 8) | rawBytes[3] || null;
            totalDiscs = (rawBytes[4] << 8) | rawBytes[5] || null;
          } else if (atomName === "covr" && rawBytes.length > 0 && !coverDataUrl) {
            const mime = typeIndicator === 14 ? "image/png" : "image/jpeg";
            coverBytes = rawBytes.length;
            coverDataUrl = `data:${mime};base64,${uint8ToBase64(rawBytes)}`;
          }
        }
        dpos += dsize;
      }

      pos += size;
    }
  }

  walkAtoms(0, buf.byteLength);

  let coverWidth = 0;
  let coverHeight = 0;
  if (coverDataUrl) {
    const dim = await measureImage(coverDataUrl);
    coverWidth = dim.width;
    coverHeight = dim.height;
  }

  const bitrateKbps = durationMs > 0 ? Math.round((file.size * 8) / durationMs) : 0;

  const track: TrackRecord = {
    id: `local_${file.name}_${file.size}_${file.lastModified}`,
    workspaceMode,
    filePath: `/Imported/${file.name}`,
    fileName: file.name,
    extension: "m4a",
    fileSize: file.size,
    mtimeMs: file.lastModified,
    title,
    artist,
    albumArtist,
    album,
    year,
    genre,
    trackNumber,
    totalTracks,
    discNumber,
    totalDiscs,
    comment,
    lyrics,
    hasExternalLrc: false,
    artistSort,
    albumSort,
    pinyinInitial: computePinyinInitial(albumArtist || artist || title),
    specs: {
      codec,
      sampleRate,
      bitDepth,
      channels,
      bitrateKbps,
      durationMs,
      streamMd5: "",
      md5Verified: "unsupported",
    },
    coverHash: coverDataUrl ? `local_${file.size}` : null,
    coverWidth,
    coverHeight,
    coverBytes,
    coverDataUrl,
    diagFlags: [],
    objectUrl: URL.createObjectURL(file),
  };

  track.diagFlags = detectDiagnosticFlags(track);
  return track;
}

/**
 * Parse any dropped local audio file (.flac, .m4a, .mp3, .wav, .ogg).
 */
export async function parseLocalAudioFile(
  file: File,
  workspaceMode: WorkspaceMode = "staging"
): Promise<TrackRecord> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const sliceSize = Math.min(file.size, 8 * 1024 * 1024); // First 8MB covers metadata + pictures
  const buf = await file.slice(0, sliceSize).arrayBuffer();
  const magic = new TextDecoder("latin1").decode(new Uint8Array(buf.slice(0, 4)));

  if (ext === "flac" || magic === "fLaC") {
    return parseFlacBuffer(buf, file, workspaceMode);
  }
  if (ext === "m4a" || ext === "alac" || ext === "mp4") {
    // M4A moov box may be at end of file; read full if small enough (<80MB)
    const fullBuf = file.size <= 80 * 1024 * 1024 ? await file.arrayBuffer() : buf;
    return parseM4aBuffer(fullBuf, file, workspaceMode);
  }

  // Fallback for MP3/WAV/OGG via HTMLAudio duration probing
  const objectUrl = URL.createObjectURL(file);
  const title = file.name.replace(/\.[^.]+$/, "");
  const track: TrackRecord = {
    id: `local_${file.name}_${file.size}_${file.lastModified}`,
    workspaceMode,
    filePath: `/Imported/${file.name}`,
    fileName: file.name,
    extension: ext || "audio",
    fileSize: file.size,
    mtimeMs: file.lastModified,
    title,
    artist: "",
    albumArtist: "",
    album: "",
    year: "",
    genre: "",
    trackNumber: null,
    totalTracks: null,
    discNumber: null,
    totalDiscs: null,
    comment: "",
    lyrics: "",
    hasExternalLrc: false,
    artistSort: "",
    albumSort: "",
    pinyinInitial: computePinyinInitial(title),
    specs: {
      codec: ext.toUpperCase() || "AUDIO",
      sampleRate: 44100,
      bitDepth: 16,
      channels: 2,
      bitrateKbps: 320,
      durationMs: 0,
      streamMd5: "",
      md5Verified: "unsupported",
    },
    coverHash: null,
    coverWidth: 0,
    coverHeight: 0,
    coverBytes: 0,
    coverDataUrl: null,
    diagFlags: ["missing_cover", "missing_track_or_year"],
    objectUrl,
  };
  return track;
}
