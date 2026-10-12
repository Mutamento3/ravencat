/** 原生层拥有联网、重定向、响应大小和公共下载目录边界；此处只连接运行取消。 */
import { requireNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';

export type WebResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface WebSearchResult {
  query: string;
  source: string;
  items: { title: string; url: string; snippet: string }[];
}

export interface WebPage {
  url: string;
  title: string;
  contentType: string;
  text: string;
  truncated: boolean;
  links: { title: string; url: string }[];
}

export interface WebDownload {
  url: string;
  uri: string;
  fileName: string;
  directory: string;
  mimeType: string;
  sizeBytes: number;
}

interface WebToolsNativeModule {
  createRequest(): string;
  cancelRequest(id: string): void;
  search(id: string, query: string, limit: number): Promise<WebResult<WebSearchResult>>;
  readPage(id: string, url: string, maxChars: number): Promise<WebResult<WebPage>>;
  download(id: string, url: string, fileName: string | null): Promise<WebResult<WebDownload>>;
  downloadImage(id: string, url: string, fileName: string | null): Promise<WebResult<WebDownload>>;
}

const native = requireNativeModule<WebToolsNativeModule>('RavenCatWebTools');

async function request<T>(signal: AbortSignal, execute: (id: string) => Promise<WebResult<T>>, discard?: (data: T) => void): Promise<WebResult<T>> {
  throwIfAbortSignalAborted(signal);
  // 同步创建句柄，保证取消即使先于原生异步函数启动也不会丢失。
  const id = native.createRequest();
  const cancel = () => native.cancelRequest(id);
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const result = await execute(id);
    if (signal.aborted && result.ok && discard) discard(result.data);
    throwIfAbortSignalAborted(signal);
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

export const searchWeb = (query: string, limit: number, signal: AbortSignal) =>
  request(signal, (id) => native.search(id, query, limit));
export const readWebPage = (url: string, maxChars: number, signal: AbortSignal) =>
  request(signal, (id) => native.readPage(id, url, maxChars));
export const downloadWebFile = (url: string, fileName: string | null, signal: AbortSignal) =>
  request(signal, (id) => native.download(id, url, fileName));

export const downloadWebImage = (url: string, fileName: string | null, signal: AbortSignal) =>
  request(signal, (id) => native.downloadImage(id, url, fileName), (data) => {
    try { new File(data.uri).delete(); }
    catch (error) { console.warn('[WebTools] 已取消图片下载的暂存清理失败：', error); }
  });
