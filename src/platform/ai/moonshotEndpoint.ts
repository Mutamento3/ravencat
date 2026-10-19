/** 官方工具只接受 Moonshot 的 OpenAI API 根地址，不根据模型名或域名子串推断。 */
export function resolveMoonshotAPIBaseURL(baseURL: string | null | undefined): string | null {
  if (!baseURL) return null;
  let url: URL;
  try { url = new URL(baseURL.trim()); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return null;
  if (url.hostname !== 'api.moonshot.cn' && url.hostname !== 'api.moonshot.ai') return null;
  if (!['', '/v1'].includes(url.pathname.replace(/\/+$/, ''))) return null;
  return `${url.origin}/v1`;
}
