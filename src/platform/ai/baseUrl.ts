/**
 * @fileoverview AI API Base URL 规范化工具
 *
 * 兼容 OpenAI 风格 `/v1` 地址，以及智谱 BigModel 这类
 * 已经自带版本路径的地址（如 `/api/paas/v4`）。
 *
 * @module platform/ai/baseUrl
 */

/**
 * 判断 URL 路径中是否已经包含版本段。
 * 例如：/v1、/v4、/api/paas/v4 都视为"已带版本"。
 *
 * @param url - URL 字符串
 * @returns 是否包含版本段
 */
function hasVersionSegment(url: string): boolean {
  return /\/v\d+(?:\/)?$/i.test(url) || /\/v\d+\//i.test(url);
}

/**
 * 规范化 AI API Base URL。
 *
 * 规则：
 * - 去掉末尾多余 `/`
 * - 若未显式携带版本段，则补上 `/v1`
 * - 若已包含 `/v4` 等版本段，则保持原样
 *
 * @param baseURL - 原始 Base URL
 * @returns 规范化后的 URL
 */
export function normalizeAIBaseURL(baseURL: string): string {
  const normalized = String(baseURL || '').trim().replace(/\/+$/, '');

  if (!normalized) {
    return '';
  }

  if (hasVersionSegment(normalized)) {
    return normalized;
  }

  return `${normalized}/v1`;
}
