/** 原生层拥有联网、重定向、响应大小和公共下载目录边界；此处只连接运行取消。 */
import { requireNativeModule } from 'expo';
import { File } from 'expo-file-system';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export type WebResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type WebSearchEngine = 'bing' | 'duckduckgo' | 'tavily' | 'brave';
export type WebConnectionMode = 'direct' | 'system';
export interface WebSearchOptions {
  engine: WebSearchEngine;
  apiKey: string | null;
  depth: 'basic' | 'advanced';
  timeRange: 'day' | 'week' | 'month' | 'year' | null;
  includeImages: boolean;
}

export interface WebPageOptions {
  startChar?: number;
  find?: string;
  documentVersion?: string;
}

export interface WebSearchResult {
  query: string;
  source: string;
  engine: WebSearchEngine;
  duplicatesRemoved: number;
  items: { title: string; url: string; snippet: string; score?: number; publishedAt?: string }[];
  /** 搜索服务提供的候选资料；图片下载、文件验证与视觉读取由各自工具负责。 */
  images?: { url: string; description: string; sourceUrl?: string }[];
}

export interface WebPage {
  url: string;
  title: string;
  contentType: string;
  text: string;
  truncated: boolean;
  startChar: number;
  nextStartChar: number | null;
  totalChars: number;
  documentVersion: string;
  matches: { startChar: number; text: string }[];
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
  createRequest(connectionMode: WebConnectionMode): string;
  cancelRequest(id: string): void;
  search(id: string, query: string, limit: number, engine: WebSearchEngine, apiKey: string | null, depth: string, timeRange: string | null, includeImages: boolean): Promise<WebResult<WebSearchResult>>;
  readPage(id: string, url: string, maxChars: number, startChar: number, find: string | null, documentVersion: string | null): Promise<WebResult<WebPage>>;
  download(id: string, url: string, fileName: string | null): Promise<WebResult<WebDownload>>;
  downloadImage(id: string, url: string, fileName: string | null): Promise<WebResult<WebDownload>>;
}

const native = requireNativeModule<WebToolsNativeModule>('RavenCatWebTools');
const transport = createRuntimeSlot<{ readConnectionMode(): Promise<WebConnectionMode> }>('联网连接方式');
export const configureWebTransport = transport.configure;

async function request<T>(signal: AbortSignal, execute: (id: string) => Promise<WebResult<T>>, discard?: (data: T) => void): Promise<WebResult<T>> {
  throwIfAbortSignalAborted(signal);
  // 每次请求冻结已持久化的连接方式；在途请求不随设置页切换改变路由。
  const connectionMode = await transport.get().readConnectionMode();
  throwIfAbortSignalAborted(signal);
  // 同步创建句柄，保证取消即使先于原生异步函数启动也不会丢失。
  const id = native.createRequest(connectionMode);
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

export const searchWeb = (query: string, limit: number, signal: AbortSignal, options: WebSearchOptions) =>
  request(signal, (id) => native.search(id, query, limit, options.engine, options.apiKey, options.depth, options.timeRange, options.includeImages));
export const readWebPage = (url: string, maxChars: number, signal: AbortSignal, options: WebPageOptions = {}) =>
  request(signal, (id) => native.readPage(id, url, maxChars, options.startChar ?? 0, options.find ?? null, options.documentVersion ?? null));
export const downloadWebFile = (url: string, fileName: string | null, signal: AbortSignal) =>
  request(signal, (id) => native.download(id, url, fileName));

export const downloadWebImage = (url: string, fileName: string | null, signal: AbortSignal) =>
  request(signal, (id) => native.downloadImage(id, url, fileName), (data) => {
    try { new File(data.uri).delete(); }
    catch (error) { console.warn('[WebTools] 已取消图片下载的暂存清理失败：', error); }
  });
