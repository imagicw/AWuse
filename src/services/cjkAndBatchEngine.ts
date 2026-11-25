import {
  FinderBatchRule,
  ReorganizePreviewItem,
  ReorganizeRule,
  StagedChange,
  TagPatch,
  TrackRecord,
} from "../types/music";

// Standard GB2312 / Intl.Collator pinyin boundary anchors for exact A-Z bucket detection
const PINYIN_LETTERS = "ABCDEFGHJKLMNOPQRSTWXYZ".split("");
const PINYIN_ANCHORS = "啊芭擦搭蛾发噶哈击喀拉妈拿哦啪期然撒塌挖昔压匝".split("");
const zhCollator = new Intl.Collator("zh-Hans-CN", { sensitivity: "accent" });

const COMMON_CHAR_PINYIN: Record<string, string> = {
  周: "Zhou", 杰: "Jie", 伦: "Lun", 陈: "Chen", 奕: "Yi", 迅: "Xun",
  王: "Wang", 菲: "Fei", 陶: "Tao", 喆: "Zhe", 窦: "Dou", 唯: "Wei",
  林: "Lin", 俊: "Jun", 张: "Zhang", 学: "Xue", 友: "You", 惠: "Hui",
  妹: "Mei", 孙: "Sun", 燕: "Yan", 姿: "Zi", 蔡: "Cai", 依: "Yi",
  邓: "Deng", 丽: "Li", 君: "Jun", 范: "Fan", 特: "Te", 西: "Xi",
  八: "Ba", 度: "Du", 空: "Kong", 间: "Jian", 寓: "Yu", 言: "Yan",
  黑: "Hei", 梦: "Meng", 坂: "Ban", 本: "Ben", 龙: "Long", 一: "Yi",
  爱: "Ai", 在: "Zai", 公: "Gong", 元: "Yuan", 前: "Qian", 简: "Jian",
  单: "Dan", 安: "An", 静: "Jing", 浮: "Fu", 夸: "Kua", 夕: "Xi",
  阳: "Yang", 无: "Wu", 限: "Xian", 好: "Hao", 葡: "Pu", 萄: "Tao",
  成: "Cheng", 熟: "Shu", 时: "Shi", 温: "Wen", 岚: "Lan", 屋: "Wu",
  顶: "Ding", 爸: "Ba", 我: "Wo", 回: "Hui", 来: "Lai", 了: "Liao",
  笑: "Xiao", 忘: "Wang", 书: "Shu", 彼: "Bi", 岸: "An", 花: "Hua",
  半: "Ban", 岛: "Dao", 铁: "Tie", 盒: "He", 暗: "An", 号: "Hao",
  米: "Mi", 兰: "Lan", 的: "De", 小: "Xiao", 匠: "Jiang", 高: "Gao",
  级: "Ji", 动: "Dong", 物: "Wu", 阿: "A", 牛: "Niu", 飞: "Fei",
  机: "Ji", 场: "Chang", 十: "Shi", 街: "Jie", 镇: "Zhen",
  姑: "Gu", 娘: "Niang", 叶: "Ye", 美: "Mei",
};

const TRAD_TO_SIMP: Record<string, string> = {
  范: "范", 夢: "梦", 愛: "爱", 簡: "简", 單: "单", 安: "安", 靜: "静",
  誇: "夸", 陽: "阳", 無: "无", 葡: "葡", 萄: "萄", 時: "时", 嵐: "岚",
  頂: "顶", 回: "回", 來: "来", 書: "书", 島: "岛", 鐵: "铁", 號: "号",
  蘭: "兰", 高級: "高级", 動: "动", 飛: "飞", 機: "机", 場: "场",
  鎮: "镇", 倫: "伦", 傑: "杰", 陳: "陈", 張: "张", 學: "学",
  龍: "龙", 坂: "坂", 專: "专", 輯: "辑", 歌: "歌", 詞: "词",
  樂: "乐", 國: "国", 粵: "粤", 語: "语", 華: "华", 風: "风",
  雲: "云", 聽: "听", 說: "说", 傷: "伤", 離: "离", 別: "别",
  歲: "岁", 月: "月", 雙: "双", 截: "截", 棍: "棍", 開: "开",
  瞭: "了", 門: "门", 東: "东", 亞: "亚", 臺: "台", 灣: "湾",
  香: "香", 港: "港", 演: "演", 唱: "唱", 會: "会", 現場: "现场",
  版: "版", 週: "周", 記: "记", 憶: "忆", 紅: "红", 塵: "尘",
  葉: "叶", 惠: "惠", 鄧: "邓", 麗: "丽", 蔡: "蔡", 依: "依",
  林: "林", 孫: "孙",
};

const SIMP_TO_TRAD: Record<string, string> = Object.fromEntries(
  Object.entries(TRAD_TO_SIMP)
    .filter(([k, v]) => k !== v && k.length === 1 && v.length === 1)
    .map(([k, v]) => [v, k])
);

export function computePinyinInitial(text: string): string {
  const s = text.trim();
  if (!s) return "#";
  const first = s[0];
  if (/[a-zA-Z]/.test(first)) {
    return first.toUpperCase();
  }
  if (/[\u4e00-\u9fff]/.test(first)) {
    if (COMMON_CHAR_PINYIN[first]) {
      return COMMON_CHAR_PINYIN[first][0].toUpperCase();
    }
    let matched = "#";
    for (let i = PINYIN_ANCHORS.length - 1; i >= 0; i--) {
      if (zhCollator.compare(first, PINYIN_ANCHORS[i]) >= 0) {
        matched = PINYIN_LETTERS[i];
        break;
      }
    }
    return matched;
  }
  return "#";
}

export function toPinyinSortKey(text: string): string {
  const s = text.trim();
  if (!s) return "";
  const tokens: string[] = [];
  let asciiBuf = "";
  for (const ch of s) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      asciiBuf += ch;
    } else {
      if (asciiBuf) {
        tokens.push(asciiBuf);
        asciiBuf = "";
      }
      if (/[\u4e00-\u9fff]/.test(ch)) {
        tokens.push(COMMON_CHAR_PINYIN[ch] ?? computePinyinInitial(ch));
      }
    }
  }
  if (asciiBuf) tokens.push(asciiBuf);
  return tokens.join(" ");
}

// Mojibake from a legacy codepage read as Latin-1 shows up as runs of >=2
// Latin-1 chars (each source byte maps to one such char). A single char like
// "é" in "Beyoncé" or "°" is legitimate text, not mojibake.
const MOJIBAKE_RUN = /[\u0080-\u00ff]{2,}/g;
const MOJIBAKE_RUN_TEST = /[\u0080-\u00ff]{2,}/;
const KANA_RE = /[\u3040-\u30ff\uff66-\uff9d]/;

export function containsKana(text: string): boolean {
  return KANA_RE.test(text);
}

export function looksLikeMojibake(text: string): boolean {
  return MOJIBAKE_RUN_TEST.test(text);
}

/**
 * Decode ISO-8859-1 misinterpreted byte runs back as GB18030 / Big5 / Shift-JIS
 * -> UTF-8. Only the Latin-1 runs are re-decoded; surrounding valid text
 * (e.g. Japanese kanji/kana mixed with one corrupted segment) is preserved.
 */
export function repairMojibake(
  text: string,
  encoding: "gb18030" | "big5" | "shift_jis" = "gb18030"
): string {
  if (!looksLikeMojibake(text)) return text;
  return text.replace(MOJIBAKE_RUN, (seg) => {
    const bytes = new Uint8Array(
      Array.from(seg).map((c) => c.charCodeAt(0) & 0xff)
    );
    try {
      return new TextDecoder(encoding, { fatal: false }).decode(bytes);
    } catch {
      return seg;
    }
  });
}

export function convertTraditionalSimplified(
  text: string,
  direction: "t2s" | "s2t"
): string {
  // Strings containing kana are Japanese, not Chinese — a trad/simp dict
  // would corrupt names like 坂本龍一 / 宇多田ヒカル.
  if (containsKana(text)) return text;
  const dict = direction === "t2s" ? TRAD_TO_SIMP : SIMP_TO_TRAD;
  return Array.from(text)
    .map((ch) => dict[ch] ?? ch)
    .join("");
}

export function normalizeCjkPunctuation(text: string): string {
  return text
    .replace(/（/g, " (")
    .replace(/）/g, ")")
    .replace(/【/g, " [")
    .replace(/】/g, "]")
    .replace(/　/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function extractPrimaryArtist(artist: string): string {
  return artist
    .replace(/\s*(?:feat\.?|ft\.?|featuring|\/|;|、|&)\s*.*$/i, "")
    .trim();
}

export const DIAG_FLAG_LABELS: Record<string, string> = {
  missing_cover: "缺失封面",
  fragmented_album: "散碎专辑 / Feat.",
  encoding_issue: "乱码 / 标点异常",
  missing_track_or_year: "缺失曲目号 / 年份",
  unorganized_path: "待归档目录",
  md5_mismatch: "MD5 校验异常",
};

export function describeDiagFlags(flags: string[]): string {
  return flags.map((f) => DIAG_FLAG_LABELS[f] ?? f).join("、");
}

// Compact labels for narrow status cells (full labels stay in tooltips)
const DIAG_FLAG_LABELS_SHORT: Record<string, string> = {
  missing_cover: "缺失封面",
  fragmented_album: "散碎专辑",
  encoding_issue: "乱码/标点",
  missing_track_or_year: "缺号/缺年",
  unorganized_path: "待归档",
  md5_mismatch: "MD5异常",
};

export function describeDiagFlagsShort(flags: string[]): string {
  return flags.map((f) => DIAG_FLAG_LABELS_SHORT[f] ?? f).join("、");
}

export function detectDiagnosticFlags(track: TrackRecord): string[] {
  const flags: string[] = [];
  if (!track.coverDataUrl && !track.coverHash) {
    flags.push("missing_cover");
  }
  const hasFeat = /\b(?:feat\.?|ft\.?|featuring)\b|\/|;|、/i.test(track.artist);
  if (hasFeat && !track.albumArtist.trim()) {
    flags.push("fragmented_album");
  }
  if (
    looksLikeMojibake(track.title) ||
    looksLikeMojibake(track.artist) ||
    looksLikeMojibake(track.album) ||
    /[（）【】　]/.test(track.title) ||
    /[（）【】　]/.test(track.album)
  ) {
    flags.push("encoding_issue");
  }
  if (!track.trackNumber || !track.year.trim()) {
    flags.push("missing_track_or_year");
  }
  if (
    track.filePath.includes("/Downloads/") ||
    track.filePath.includes("/Unsorted/") ||
    track.filePath.includes("/Imported/")
  ) {
    flags.push("unorganized_path");
  }
  if (track.specs.md5Verified === "mismatch") {
    flags.push("md5_mismatch");
  }
  return flags;
}

export function planUnifyFragmentedAlbums(tracks: TrackRecord[]): StagedChange[] {
  const groups = new Map<string, TrackRecord[]>();
  for (const t of tracks) {
    const cleanAlbum = t.album
      .replace(/\s*[\(\[]?(?:CD|Disc)\s*\d+[\)\]]?/i, "")
      .trim()
      .toLowerCase();
    const key = `${t.filePath.split("/").slice(0, -1).join("/")}::${cleanAlbum}`;
    const list = groups.get(key) ?? [];
    list.push(t);
    groups.set(key, list);
  }

  const changes: StagedChange[] = [];
  for (const [, group] of groups) {
    const counts = new Map<string, number>();
    for (const t of group) {
      const base = t.albumArtist.trim() || extractPrimaryArtist(t.artist);
      if (base) counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    let dominant = "";
    let best = 0;
    for (const [name, c] of counts) {
      if (c > best) {
        best = c;
        dominant = name;
      }
    }
    if (!dominant) continue;

    for (const t of group) {
      const patch: TagPatch = {};
      let dirty = false;
      if (t.albumArtist.trim() !== dominant) {
        patch.albumArtist = dominant;
        dirty = true;
      }
      if (!t.discNumber && /\((?:CD|Disc)\s*(\d+)\)/i.test(t.album)) {
        const m = t.album.match(/\((?:CD|Disc)\s*(\d+)\)/i);
        if (m) {
          patch.discNumber = parseInt(m[1], 10);
          patch.album = t.album.replace(/\s*\((?:CD|Disc)\s*\d+\)/i, "").trim();
          dirty = true;
        }
      }
      if (dirty) {
        changes.push({
          trackId: t.id,
          patch,
          reason: `散碎专辑归并 → Album Artist: ${dominant}`,
        });
      }
    }
  }
  return changes;
}

export function parseFilenamePattern(fileName: string, pattern: string): TagPatch | null {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regexBody = escaped
    .replace(/%track%/g, "(?<track>\\d{1,3})")
    .replace(/%disc%/g, "(?<disc>\\d{1,2})")
    .replace(/%year%/g, "(?<year>\\d{4})")
    .replace(/%album_artist%/g, "(?<album_artist>.+?)")
    .replace(/%artist%/g, "(?<artist>.+?)")
    .replace(/%album%/g, "(?<album>.+?)")
    .replace(/%title%/g, "(?<title>.+?)");

  try {
    const re = new RegExp(`^${regexBody}$`);
    const match = stem.match(re);
    if (!match || !match.groups) return null;

    const patch: TagPatch = {};
    const g = match.groups;
    if (g.track) patch.trackNumber = parseInt(g.track, 10);
    if (g.disc) patch.discNumber = parseInt(g.disc, 10);
    if (g.year) patch.year = g.year;
    if (g.artist) patch.artist = g.artist.trim();
    if (g.album_artist) patch.albumArtist = g.album_artist.trim();
    if (g.album) patch.album = g.album.trim();
    if (g.title) patch.title = g.title.trim();
    return Object.keys(patch).length > 0 ? patch : null;
  } catch {
    return null;
  }
}

export function sanitizePathSegment(input: string, fallback: string): string {
  const cleaned = input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\.+$/, "")
    .trim();
  return cleaned || fallback;
}

export function previewDirectoryReorganize(
  tracks: TrackRecord[],
  rule: ReorganizeRule
): ReorganizePreviewItem[] {
  const seen = new Map<string, number>();
  const items: ReorganizePreviewItem[] = tracks.map((t) => {
    const aa = sanitizePathSegment(t.albumArtist || t.artist, "Unknown Artist");
    const artist = sanitizePathSegment(t.artist, "Unknown Artist");
    const album = sanitizePathSegment(t.album, "Unknown Album");
    const year = sanitizePathSegment(t.year, "0000");
    const disc = String(t.discNumber ?? 1);
    const trackNum = t.trackNumber != null
      ? rule.zeroPadTrack
        ? String(t.trackNumber).padStart(2, "0")
        : String(t.trackNumber)
      : "00";
    const title = sanitizePathSegment(t.title, t.fileName.replace(/\.[^.]+$/, ""));

    let rel = rule.template
      .replace(/\{AlbumArtist\}/g, aa)
      .replace(/\{Artist\}/g, artist)
      .replace(/\{Album\}/g, album)
      .replace(/\{Year\}/g, year)
      .replace(/\{DiscNumber\}/g, disc)
      .replace(/\{TrackNumber\}/g, trackNum)
      .replace(/\{Title\}/g, title)
      .replace(/\{Format\}/g, t.specs.codec)
      .replace(/\{ext\}/g, t.extension);

    if (!rel.toLowerCase().endsWith(`.${t.extension.toLowerCase()}`)) {
      rel = `${rel}.${t.extension}`;
    }

    const root = rule.rootDir.replace(/\/+$/, "");
    const newPath = `${root}/${rel.replace(/^\/+/, "")}`;
    seen.set(newPath.toLowerCase(), (seen.get(newPath.toLowerCase()) ?? 0) + 1);

    const companions: string[] = [];
    if (rule.moveCompanions) {
      if (t.hasExternalLrc) {
        companions.push(t.filePath.replace(/\.[^.]+$/, ".lrc"));
      }
      if (t.coverDataUrl && !t.filePath.includes("/Downloads/")) {
        companions.push(`${t.filePath.split("/").slice(0, -1).join("/")}/cover.jpg`);
      }
    }

    return {
      trackId: t.id,
      oldPath: t.filePath,
      newPath,
      companionFiles: companions,
      conflict: false,
      changed: newPath !== t.filePath,
    };
  });

  for (const item of items) {
    if ((seen.get(item.newPath.toLowerCase()) ?? 0) > 1) {
      item.conflict = true;
    }
  }
  return items;
}

function escapeRegExpLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceWithRule(
  input: string,
  regex: RegExp,
  replaceText: string,
  useRegex: boolean
): string {
  return useRegex
    ? input.replace(regex, replaceText)
    : input.replace(regex, () => replaceText);
}

function splitFileNameParts(fileName: string): { stem: string; dotExt: string } {
  const idx = fileName.lastIndexOf(".");
  if (idx <= 0) return { stem: fileName, dotExt: "" };
  return { stem: fileName.slice(0, idx), dotExt: fileName.slice(idx) };
}

function buildSiblingFilePath(
  oldFilePath: string,
  newStem: string,
  fallbackExt: string
): string {
  const cleanStem = sanitizePathSegment(newStem, "Untitled");
  const lastSlash = Math.max(oldFilePath.lastIndexOf("/"), oldFilePath.lastIndexOf("\\"));
  const dir = lastSlash >= 0 ? oldFilePath.slice(0, lastSlash) : "";
  const sep = oldFilePath.includes("\\") && !oldFilePath.includes("/") ? "\\" : "/";
  const oldName = lastSlash >= 0 ? oldFilePath.slice(lastSlash + 1) : oldFilePath;
  const { dotExt } = splitFileNameParts(oldName);
  const ext = dotExt || (fallbackExt ? `.${fallbackExt}` : "");
  const nextName = `${cleanStem}${ext}`;
  return dir ? `${dir}${sep}${nextName}` : nextName;
}

function renderTagTemplateToStem(track: TrackRecord, pattern: string, zeroPadTrack: boolean): string {
  const aa = sanitizePathSegment(track.albumArtist || track.artist, "Unknown Artist");
  const artist = sanitizePathSegment(track.artist, "Unknown Artist");
  const album = sanitizePathSegment(track.album, "Unknown Album");
  const year = sanitizePathSegment(track.year, "0000");
  const disc = String(track.discNumber ?? 1);
  const trackNum =
    track.trackNumber != null
      ? zeroPadTrack
        ? String(track.trackNumber).padStart(2, "0")
        : String(track.trackNumber)
      : "00";
  const title = sanitizePathSegment(track.title, splitFileNameParts(track.fileName).stem);

  return pattern
    .replace(/\{AlbumArtist\}/g, aa)
    .replace(/\{Artist\}/g, artist)
    .replace(/\{Album\}/g, album)
    .replace(/\{Year\}/g, year)
    .replace(/\{DiscNumber\}/g, disc)
    .replace(/\{TrackNumber\}/g, trackNum)
    .replace(/\{Title\}/g, title)
    .replace(/\{Format\}/g, track.specs.codec)
    .replace(/^\.+/, "");
}

/**
 * Apply a Finder-style batch rule (replace text, add prefix/suffix, format with sequence,
 * or filename <-> tag template conversion) across selected tracks.
 */
export function applyFinderBatchRule(
  tracks: TrackRecord[],
  rule: FinderBatchRule
): StagedChange[] {
  const out: StagedChange[] = [];

  if (rule.mode === "template") {
    for (const t of tracks) {
      if (rule.templateDirection === "extract_from_filename") {
        const patch = parseFilenamePattern(t.fileName, rule.extractPattern);
        if (patch) {
          out.push({
            trackId: t.id,
            patch,
            reason: `文件名提取标签 (${rule.extractPattern})`,
          });
        }
      } else {
        const nextStem = renderTagTemplateToStem(t, rule.renamePattern, rule.zeroPadTrack);
        const newFilePath = buildSiblingFilePath(t.filePath, nextStem, t.extension);
        if (newFilePath !== t.filePath) {
          out.push({
            trackId: t.id,
            patch: { newFilePath },
            reason: `按标签重命名文件 (${rule.renamePattern})`,
          });
        }
      }
    }
    return out;
  }

  let compiledRegex: RegExp | null = null;
  if (rule.mode === "replace") {
    if (!rule.findText) return [];
    try {
      const flags = rule.caseSensitive ? "g" : "gi";
      const pattern = rule.useRegex ? rule.findText : escapeRegExpLiteral(rule.findText);
      compiledRegex = new RegExp(pattern, flags);
    } catch {
      return [];
    }
  }

  const safeStep = Number.isFinite(rule.step) && rule.step !== 0 ? rule.step : 1;
  const safeStart = Number.isFinite(rule.startIndex) ? rule.startIndex : 1;
  const safePad = Math.max(0, Math.min(8, Math.floor(rule.zeroPad || 0)));

  tracks.forEach((t, idx) => {
    if (rule.targetField === "trackNumber") {
      if (rule.mode === "format") {
        const seq = safeStart + idx * safeStep;
        if (seq >= 0 && seq !== t.trackNumber) {
          out.push({
            trackId: t.id,
            patch: { trackNumber: seq },
            reason: "批量递增音轨号",
          });
        }
        return;
      }
      const curStr = t.trackNumber != null ? String(t.trackNumber) : "";
      let nextStr = curStr;
      if (rule.mode === "replace" && compiledRegex) {
        nextStr = replaceWithRule(curStr, compiledRegex, rule.replaceText, rule.useRegex);
      } else if (rule.mode === "add" && rule.addText) {
        nextStr = rule.addPosition === "before" ? `${rule.addText}${curStr}` : `${curStr}${rule.addText}`;
      }
      if (nextStr !== curStr) {
        const parsed = nextStr.trim() === "" ? null : parseInt(nextStr.trim(), 10);
        if (parsed === null || Number.isFinite(parsed)) {
          out.push({
            trackId: t.id,
            patch: { trackNumber: parsed },
            reason: "批量修改音轨号",
          });
        }
      }
      return;
    }

    const curVal =
      rule.targetField === "fileName"
        ? splitFileNameParts(t.fileName).stem
        : String(t[rule.targetField] ?? "");

    let nextVal = curVal;
    if (rule.mode === "replace" && compiledRegex) {
      nextVal = replaceWithRule(curVal, compiledRegex, rule.replaceText, rule.useRegex);
    } else if (rule.mode === "add") {
      if (!rule.addText) return;
      nextVal =
        rule.addPosition === "before"
          ? `${rule.addText}${curVal}`
          : `${curVal}${rule.addText}`;
    } else if (rule.mode === "format") {
      const seqNum = Math.max(0, safeStart + idx * safeStep);
      const seqStr = safePad > 0 ? String(seqNum).padStart(safePad, "0") : String(seqNum);
      const base = rule.formatBaseMode === "custom" ? rule.customBaseText : curVal;
      nextVal =
        rule.formatPosition === "before"
          ? `${seqStr}${rule.separator}${base}`
          : `${base}${rule.separator}${seqStr}`;
    }

    if (nextVal === curVal) return;

    if (rule.targetField === "fileName") {
      const newFilePath = buildSiblingFilePath(t.filePath, nextVal, t.extension);
      if (newFilePath !== t.filePath) {
        out.push({
          trackId: t.id,
          patch: { newFilePath },
          reason: `批量重命名 (${rule.mode})`,
        });
      }
    } else {
      out.push({
        trackId: t.id,
        patch: { [rule.targetField]: nextVal },
        reason: `批量规则修改 ${rule.targetField}`,
      });
    }
  });

  return out;
}
