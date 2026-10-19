/** Moonshot 官方 REST／Formula 工具协议边界；不拥有工具授权、拆包或模型续轮。 */
import { fetch } from 'expo/fetch';
import { assertAgentToolInputSchema, matchesAgentToolInputSchema, type JsonSchema } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { resolveMoonshotAPIBaseURL } from './moonshotEndpoint';

export interface MoonshotSearchInput { query: string; limit?: number }
export interface MoonshotSearchResult {
  search_results: { title: string; url: string; snippet: string; site_name: string; date: string }[];
}
export interface MoonshotFetchResult { url: string; title: string; markdown: string }
export interface MoonshotMewInput { function_name?: string; arguments?: Record<string, unknown> }
interface FormulaFunction { name: string; description: string; parameters: JsonSchema }
export type MoonshotMewResult = { kind: 'output'; output: string }
  | { kind: 'input_required'; message: string; functions: FormulaFunction[] };
export type MoonshotToolResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

const failure = (code: string, message: string): MoonshotToolResult<never> => ({ ok: false, code, message });
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class MoonshotToolsClient {
  private readonly baseURL: string;

  constructor(private readonly config: { baseURL: string; apiKey: string }) {
    const baseURL = resolveMoonshotAPIBaseURL(config.baseURL);
    // 发送凭据的边界独占目标检查；内部调用无需再次判断官方域名。
    if (!baseURL) throw new Error('Kimi 官方工具仅支持 Moonshot 官方 API 地址');
    this.baseURL = baseURL;
  }

  async search(input: MoonshotSearchInput, signal?: AbortSignal): Promise<MoonshotToolResult<MoonshotSearchResult>> {
    const result = await this.request('tools/search', { text_query: input.query, limit: input.limit ?? 5,
      include_content: false, timeout_seconds: 30 }, signal);
    if (result.ok === false) return result;
    const data = result.data;
    if (!isRecord(data) || !Array.isArray(data.search_results) || !data.search_results.every((item) =>
      isRecord(item) && ['title', 'url', 'snippet', 'site_name', 'date'].every((key) => typeof item[key] === 'string'))) {
      return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 官方搜索返回了无效结果。');
    }
    return { ok: true, data: { search_results: data.search_results.map((item) => ({
      title: item.title as string, url: item.url as string, snippet: item.snippet as string,
      site_name: item.site_name as string, date: item.date as string,
    })) } };
  }

  async fetchPage(url: string, signal?: AbortSignal): Promise<MoonshotToolResult<MoonshotFetchResult>> {
    const result = await this.request('tools/fetch', { url }, signal);
    if (result.ok === false) return result;
    const data = result.data;
    if (!isRecord(data) || typeof data.url !== 'string' || typeof data.title !== 'string' || typeof data.markdown !== 'string') {
      return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 官方网页读取返回了无效结果。');
    }
    return { ok: true, data: { url: data.url, title: data.title, markdown: data.markdown } };
  }

  async mew(input: MoonshotMewInput, signal?: AbortSignal): Promise<MoonshotToolResult<MoonshotMewResult>> {
    const formulaPath = 'formulas/moonshot/mew:latest';
    const declaration = await this.request(`${formulaPath}/tools`, undefined, signal);
    if (declaration.ok === false) return declaration;
    const data = declaration.data;
    if (!isRecord(data) || !Array.isArray(data.tools) || data.tools.length === 0) {
      return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具没有返回有效的官方声明。');
    }
    const functions: FormulaFunction[] = [];
    const names = new Set<string>();
    for (const tool of data.tools) {
      if (!isRecord(tool) || tool.type !== 'function' || !isRecord(tool.function)) {
        return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具返回了无效的函数声明。');
      }
      const fn = tool.function;
      if (typeof fn.name !== 'string' || !fn.name || names.has(fn.name)
        || typeof fn.description !== 'string' || !isRecord(fn.parameters) || fn.parameters.type !== 'object') {
        return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具返回了无效的函数声明。');
      }
      try { assertAgentToolInputSchema(fn.parameters); }
      catch { return failure('KIMI_TOOLS_INVALID_SCHEMA', 'Kimi 猫叫工具的官方参数声明无法解析。'); }
      names.add(fn.name);
      functions.push({ name: fn.name, description: fn.description, parameters: fn.parameters });
    }
    const fn = input.function_name === undefined
      ? (functions.length === 1 ? functions[0] : undefined)
      : functions.find((item) => item.name === input.function_name);
    const args = input.arguments ?? {};
    // Runtime 已校验本地封装参数；这里校验刚从官方边界取得的另一个 schema。
    if (!fn || !matchesAgentToolInputSchema(args, fn.parameters)) {
      return { ok: true, data: { kind: 'input_required',
        message: '尚未执行猫叫工具。请按以下官方声明选择 function_name 并填写 arguments 后再次调用。', functions } };
    }
    const fiber = await this.request(`${formulaPath}/fibers`, { name: fn.name, arguments: JSON.stringify(args) }, signal);
    if (fiber.ok === false) return fiber;
    if (!isRecord(fiber.data) || typeof fiber.data.status !== 'string') {
      return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具返回了无效的执行结果。');
    }
    if (fiber.data.status !== 'succeeded') return failure('KIMI_MEW_EXECUTION_FAILED', 'Kimi 官方猫叫工具执行未成功。');
    const context = fiber.data.context;
    if (!isRecord(context)) return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具缺少执行输出。');
    // protected 输出必须原样回灌模型，不解析或改写密文。
    const output = typeof context.output === 'string' && context.output.length > 0 ? context.output : context.encrypted_output;
    if (typeof output !== 'string' || !output) return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 猫叫工具缺少执行输出。');
    return { ok: true, data: { kind: 'output', output } };
  }

  private async request(path: string, body: object | undefined, signal?: AbortSignal): Promise<MoonshotToolResult<unknown>> {
    throwIfAbortSignalAborted(signal);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    try {
      const response = await fetch(`${this.baseURL}/${path}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // 不把服务端错误正文或网络异常带回日志／模型，避免凭据被上游回显。
      if (!response.ok) return failure(`KIMI_TOOLS_HTTP_${response.status}`, `Kimi 官方工具请求失败（HTTP ${response.status}）。`);
      if (!response.body) return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 官方工具返回了空响应。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      let text = '';
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 2 * 1024 * 1024) {
            await reader.cancel();
            return failure('KIMI_TOOLS_RESPONSE_TOO_LARGE', 'Kimi 官方工具结果超过 2 MiB，请缩小查询范围。');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      try { return { ok: true, data: JSON.parse(text) as unknown }; }
      catch { return failure('KIMI_TOOLS_INVALID_RESPONSE', 'Kimi 官方工具返回了无效 JSON。'); }
    } catch {
      throwIfAbortSignalAborted(signal);
      return timedOut ? failure('KIMI_TOOLS_TIMEOUT', 'Kimi 官方工具请求超时。')
        : failure('KIMI_TOOLS_NETWORK_ERROR', 'Kimi 官方工具网络请求失败。');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
}
