/**
 * Device Control「外部可浏览 URI route」校验。
 *
 * 这是 browsable app route primitive 的输入边界，不是 arbitrary Android Intent API：
 * 只接受单个 URI 字符串，不接受 action、component/activity class、flags、extras、
 * ClipData、MIME type、grant flags、chooser、broadcast、service 或 PendingIntent。
 *
 * 具体 app route（例如某音乐 App 的歌曲 URI）的构造不属于这里，由对应 product 层负责。
 */

/** 跨 bridge 的 URI 长度上限；避免无界字符串进入 native。 */
export const MAX_BROWSABLE_URI_LENGTH = 2048;

/** 明确拒绝不属于外部 browsable navigation 的高风险 scheme。 */
const REJECTED_URI_SCHEMES: readonly string[] = [
  'file',
  'content',
  'intent',
  'javascript',
  'data',
];

export function isValidBrowsableUri(uri: unknown): uri is string {
  return (
    typeof uri === 'string'
    && uri.trim().length > 0
    && !/\s/u.test(uri)
    && uri.length <= MAX_BROWSABLE_URI_LENGTH
    && isAllowedUriScheme(readUriScheme(uri))
  );
}

/** 取 URI scheme；缺少冒号或 scheme 不符合 RFC 3986 形式时返回 null。 */
function readUriScheme(uri: string): string | null {
  const separatorIndex = uri.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }
  const scheme = uri.slice(0, separatorIndex);
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*$/u.test(scheme)) {
    return null;
  }
  return scheme.toLowerCase();
}

function isAllowedUriScheme(scheme: string | null): boolean {
  return scheme !== null && !REJECTED_URI_SCHEMES.includes(scheme);
}
