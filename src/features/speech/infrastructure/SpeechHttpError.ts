/** HTTP 边界一次读取错误正文；保留服务端原因与脱敏原文，不记录请求或鉴权头。 */
export async function readSpeechHttpError(response: Response, provider: string, apiKey: string): Promise<Error> {
  const responseBody = await response.text();
  let message = response.statusText;
  try {
    const data: unknown = JSON.parse(responseBody);
    if (data !== null && typeof data === 'object') {
      const nested = 'error' in data ? data.error : null;
      if (nested !== null && typeof nested === 'object' && 'message' in nested
        && typeof nested.message === 'string' && nested.message.trim()) {
        message = nested.message;
      } else if ('message' in data && typeof data.message === 'string' && data.message.trim()) {
        message = data.message;
      }
    }
  } catch {
    // 网关可能返回 HTML、纯文本或空正文；原文留在下方，HTTP 状态仍然可读。
  }
  let detail = `${provider} HTTP ${response.status}${message ? `: ${message}` : ''}`;
  if (responseBody) detail += `\n响应正文：\n${responseBody}`;
  // 服务端可能回显密钥；在错误离开 HTTP 边界前，同时处理正文中的原值与转义值。
  if (apiKey) {
    for (const secret of new Set([apiKey, JSON.stringify(apiKey).slice(1, -1), encodeURIComponent(apiKey)]))
      detail = detail.split(secret).join('[REDACTED]');
  }
  return new Error(detail);
}
