/** Sticker 语义搜索的纯排序规则与分组浏览的稳定分页契约。 */

export interface StickerSearchCandidateInput {
  stickerId: string;
  /** 已映射到 0..1 的语义相似度；无向量候选时不提供。 */
  semanticScore?: number;
  /** 已映射到 0..1 的词面匹配得分（按词面候选排名归一）。 */
  lexicalScore: number;
  isFavorite: boolean;
  useCount: number;
}

export interface ScoredStickerSearchCandidate {
  stickerId: string;
  finalScore: number;
}

/**
 * Hybrid rerank：语义相似度为主，词面匹配次之，favorite / 使用历史只做轻微
 * rerank，防止常用历史让 AI 永远只发同几张。权重不是持久 contract。
 */
export const STICKER_SEARCH_SCORE_WEIGHTS = {
  semantic: 0.8,
  lexical: 0.12,
  favorite: 0.03,
  usage: 0.05,
} as const;

/** 使用历史的轻量归一：前 20 次使用线性增长，之后封顶。 */
export function normalizeStickerUsageScore(useCount: number): number {
  if (!Number.isFinite(useCount) || useCount <= 0) return 0;
  return Math.min(1, useCount / 20);
}

export function combineStickerSearchScore(candidate: StickerSearchCandidateInput): number {
  const { semantic, lexical, favorite, usage } = STICKER_SEARCH_SCORE_WEIGHTS;
  return (
    (candidate.semanticScore ?? 0) * semantic
    + candidate.lexicalScore * lexical
    + (candidate.isFavorite ? 1 : 0) * favorite
    + normalizeStickerUsageScore(candidate.useCount) * usage
  );
}

/**
 * 合并语义候选与词面候选并按 finalScore 降序。词面候选的 semanticScore 视为
 * 缺省 0 分，但仍保留词面与行为分，保证 embedding 不可用时 lexical fallback
 * 依旧是主要排序依据。
 */
export function rankStickerSearchCandidates(
  candidates: readonly StickerSearchCandidateInput[],
  limit: number,
): ScoredStickerSearchCandidate[] {
  const scored = candidates.map((candidate) => ({
    stickerId: candidate.stickerId,
    finalScore: combineStickerSearchScore(candidate),
  }));
  scored.sort((left, right) =>
    right.finalScore - left.finalScore
    || (left.stickerId < right.stickerId ? -1 : left.stickerId > right.stickerId ? 1 : 0),
  );
  return scored.slice(0, Math.max(0, Math.floor(limit)));
}

// ---------------------------------------------------------------------------
// 分组浏览 keyset 分页：cursor 是 (createdAt, id) 的透明编码，保证同一组内容
// 在多次翻页间排序稳定，也避免向模型暴露可变 offset。
//
// 编码必须能在 React Native / Hermes 上直接跑：这里刻意不使用 Node 的全局
// `Buffer`，也不依赖运行环境是否自带 `btoa` / `atob` / `TextEncoder`，
// 而是自带一份最小的 UTF-8 + base64url 实现。verifier 会在把这些全局置空
// 的环境里跑一遍，确保没有隐藏的平台假设。
// ---------------------------------------------------------------------------

export interface StickerGroupPageCursor {
  createdAt: string;
  stickerId: string;
}

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encodeUtf8(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let codePoint = text.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = ((codePoint - 0xd800) << 10) + (low - 0xdc00) + 0x10000;
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
}

/** 严格解码：任何非法字节序列返回 null，让调用方按“非法 cursor”处理。 */
function decodeUtf8(bytes: readonly number[]): string | null {
  let text = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index];
    let codePoint: number;
    let continuation: number;
    if (first < 0x80) {
      codePoint = first;
      continuation = 0;
    } else if ((first & 0xe0) === 0xc0) {
      codePoint = first & 0x1f;
      continuation = 1;
    } else if ((first & 0xf0) === 0xe0) {
      codePoint = first & 0x0f;
      continuation = 2;
    } else if ((first & 0xf8) === 0xf0) {
      codePoint = first & 0x07;
      continuation = 3;
    } else {
      return null;
    }
    if (index + continuation >= bytes.length) return null;
    for (let offset = 1; offset <= continuation; offset += 1) {
      const next = bytes[index + offset];
      if ((next & 0xc0) !== 0x80) return null;
      codePoint = (codePoint << 6) | (next & 0x3f);
    }
    if (codePoint > 0x10ffff) return null;
    if (codePoint > 0xffff) {
      const surrogate = codePoint - 0x10000;
      text += String.fromCharCode(
        0xd800 + (surrogate >> 10),
        0xdc00 + (surrogate & 0x3ff),
      );
    } else {
      text += String.fromCharCode(codePoint);
    }
    index += continuation + 1;
  }
  return text;
}

function encodeBase64Url(bytes: readonly number[]): string {
  let encoded = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64URL_ALPHABET[first >> 2];
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    if (second === undefined) break;
    encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    if (third === undefined) break;
    encoded += BASE64URL_ALPHABET[third & 0x3f];
  }
  return encoded;
}

function decodeBase64Url(value: string): number[] | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = BASE64URL_ALPHABET.indexOf(value[index]);
    if (digit < 0) return null;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  // 尾部残留的填充位必须全是 0，否则说明不是本编码产生的 cursor。
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return null;
  return bytes;
}

export function encodeStickerGroupPageCursor(
  cursor: StickerGroupPageCursor,
): string {
  return encodeBase64Url(
    encodeUtf8(JSON.stringify({ at: cursor.createdAt, id: cursor.stickerId })),
  );
}

export function decodeStickerGroupPageCursor(
  value: string,
): StickerGroupPageCursor | null {
  const bytes = decodeBase64Url(value);
  if (!bytes) return null;
  const text = decodeUtf8(bytes);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.at !== 'string' || typeof record.id !== 'string') return null;
    if (!record.at || !record.id) return null;
    return { createdAt: record.at, stickerId: record.id };
  } catch {
    return null;
  }
}
