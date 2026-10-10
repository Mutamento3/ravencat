/** MCP Streamable HTTP 共享传输：超时/取消、有界读取、JSON/SSE 解析与错误映射钩子。 */

import { MCP_TIMEOUT_ABORT_REASON, McpClientError } from '../McpClientError';
import type {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpListToolsResult,
  McpToolDefinition,
} from '../McpProtocolTypes';

/** JSON-RPC 标准错误码：Method not found（Server 不实现请求的方法）。 */
export const JSON_RPC_ERROR_METHOD_NOT_FOUND = -32601;

/** MCP 2026-07-28 规范保留错误码：UnsupportedProtocolVersionError。 */
export const JSON_RPC_ERROR_UNSUPPORTED_PROTOCOL_VERSION = -32022;

/** tools/list 分页、响应体上限与默认超时的共用默认值。 */
export const MCP_TOOLS_LIST_DEFAULTS = {
  maxListPages: 20,
  maxListTools: 500,
  maxResponseBytes: 512 * 1024,
  defaultTimeoutMs: 30_000,
} as const;

/** 规范化后的 JSON-RPC error（code/message 缺失时已补默认值）。 */
export interface JsonRpcWireError {
  code: number;
  message: string;
  data?: unknown;
}

/** 非 2xx 响应在认证/重定向边界之后读取的有界错误上下文。 */
export interface McpHttpErrorContext {
  contentType: string;
  body: string;
}

/** HTTP body 的 JSON-RPC 形态；Legacy 握手只把无法解析的旧服务拒绝识别为不支持。 */
export type McpJsonRpcErrorBody =
  | { kind: 'error'; error: JsonRpcWireError }
  | { kind: 'jsonrpc' }
  | { kind: 'json' }
  | { kind: 'unparseable' };

/** JSON-RPC error → McpClientError 的映射：由各 Adapter 决定具体协议语义。 */
export type JsonRpcErrorMapper = (error: JsonRpcWireError) => McpClientError;

/** 默认 JSON-RPC error 映射：统一 PROTOCOL_ERROR，保持传输层不解释 era。 */
export function mapRpcErrorToProtocolError(error: JsonRpcWireError): McpClientError {
  return new McpClientError('PROTOCOL_ERROR', `MCP 协议错误（${error.code}）：${error.message}`);
}

/** 默认非 2xx 状态码映射：HTTP_ERROR。 */
export function mapHttpStatusToHttpError(
  status: number,
  _context?: McpHttpErrorContext
): McpClientError {
  return new McpClientError('HTTP_ERROR', `MCP Server 返回 HTTP ${status}`);
}

/**
 * 读取 established Modern HTTP 400 中属于当前请求的 JSON-RPC error。
 * 只有 application/json、完整 JSON-RPC error envelope 与精确 request id 同时匹配才返回；
 * 其他 body 继续由 HTTP 状态语义拥有。
 */
export function readMatchingJsonRpcError(
  context: McpHttpErrorContext | undefined,
  expectedId: number | string
): JsonRpcWireError | null {
  if (!context?.contentType.toLowerCase().includes('application/json')) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(context.body);
  } catch {
    return null;
  }
  if (
    !parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || (parsed as { jsonrpc?: unknown }).jsonrpc !== '2.0'
    || (parsed as { id?: unknown }).id !== expectedId
  ) {
    return null;
  }
  const error = (parsed as { error?: unknown }).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return null;
  }
  const candidate = error as { code?: unknown; message?: unknown; data?: unknown };
  if (typeof candidate.code !== 'number' || typeof candidate.message !== 'string') {
    return null;
  }
  return {
    code: candidate.code,
    message: candidate.message,
    data: candidate.data,
  };
}

/**
 * 握手 HTTP 错误的共同映射：先看有界 body 中的 JSON-RPC error，避免把
 * 2026 HeaderMismatch 等真实协议错误误判成旧协议；只有完全无法解析的
 * 400/404/405 body 才保留旧服务拒绝语义。
 */
export function mapMcpHandshakeHttpError(
  status: number,
  context: McpHttpErrorContext | undefined,
  legacyMessage: string,
  mapRpcError: JsonRpcErrorMapper
): McpClientError {
  const body = parseJsonRpcErrorBody(context);
  if (body.kind === 'error') {
    return mapRpcError(body.error);
  }
  if (body.kind === 'unparseable' && (status === 400 || status === 404 || status === 405)) {
    return new McpClientError(
      'PROTOCOL_VERSION_UNSUPPORTED',
      `${legacyMessage}（HTTP ${status}）`
    );
  }
  if (body.kind === 'jsonrpc' || body.kind === 'json') {
    return new McpClientError(
      'PROTOCOL_ERROR',
      `MCP 握手返回 HTTP ${status}，body 不是可接受的 JSON-RPC error`
    );
  }
  return mapHttpStatusToHttpError(status, context);
}

export interface McpHttpJsonRpcTransportOptions {
  url: string;
  bearerToken?: string;
  timeoutMs: number;
  /**
   * 整个操作的绝对截止时间戳（epoch ms）；
   * 每个网络请求 timer 只使用剩余时间，不逐请求重置完整预算。
   */
  deadlineAt?: number | null;
  /** 单次 HTTP 响应体上限（字节）。 */
  maxResponseBytes: number;
}

export interface McpHttpJsonRpcPostOptions {
  headers: Record<string, string>;
  signal: AbortSignal;
  /** notification：读完响应体即完成，跳过读后中止检查与 JSON-RPC 解析。 */
  isNotification?: boolean;
  /** 状态码校验通过后的响应头回调（Legacy 用于捕获 Mcp-Session-Id）。 */
  onResponseHeaders?: (headers: Headers) => void;
  /** 非 2xx 状态码错误映射；缺省 HTTP_ERROR。 */
  mapHttpError?: (status: number, context?: McpHttpErrorContext) => McpClientError;
}

/** POST 的有响应体结果：contentType 原样返回，body 为有界读取的全文。 */
export interface McpHttpJsonRpcPostResult {
  contentType: string;
  body: string;
}

export class McpHttpJsonRpcTransport {
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly deadlineAt: number | null;
  private readonly maxResponseBytes: number;
  private readonly authorization: Record<string, string>;

  constructor(options: McpHttpJsonRpcTransportOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs;
    this.deadlineAt = options.deadlineAt ?? null;
    this.maxResponseBytes = options.maxResponseBytes;
    this.authorization = options.bearerToken === undefined ? {}
      : { Authorization: `Bearer ${options.bearerToken}` };
  }

  /** DELETE close：仅 Legacy 协议使用；使用完整 timeoutMs 预算，不读响应体。 */
  async delete(options: { headers: Record<string, string> }): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(MCP_TIMEOUT_ABORT_REASON), this.timeoutMs);
    try {
      await fetch(this.url, {
        method: 'DELETE',
        headers: { ...options.headers, ...this.authorization },
        signal: controller.signal,
        redirect: 'manual',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async postJson(
    request: McpJsonRpcRequest,
    options: McpHttpJsonRpcPostOptions
  ): Promise<McpHttpJsonRpcPostResult> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(MCP_TIMEOUT_ABORT_REASON),
      this.remainingRequestMs()
    );
    const forwardAbort = (): void => {
      if (options.signal.aborted) {
        controller.abort(options.signal.reason);
      }
    };
    if (options.signal.aborted) {
      forwardAbort();
    } else {
      options.signal.addEventListener('abort', forwardAbort, { once: true });
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: { ...options.headers, ...this.authorization },
        body: JSON.stringify(request),
        signal: controller.signal,
        redirect: 'manual',
      });
      if (controller.signal.aborted) {
        throw this.abortError(controller.signal);
      }
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new McpClientError(
          'REDIRECT_NOT_ALLOWED',
          `MCP HTTP 重定向被禁止（HTTP ${response.status}）；客户端不会跟随任何 3xx`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new McpClientError('AUTH_REQUIRED', `MCP Server 要求认证（HTTP ${response.status}）`);
      }
      if (!response.ok) {
        // 认证/重定向已在上面作为独立边界处理；其余错误体有界读取后交给
        // 握手 mapper 识别 JSON-RPC 拒绝信号，避免仅凭状态码解释协议时代。
        const contentType = response.headers.get('content-type') ?? '';
        const body = await this.readBoundedText(response);
        if (controller.signal.aborted) {
          throw this.abortError(controller.signal);
        }
        throw (options.mapHttpError ?? mapHttpStatusToHttpError)(response.status, {
          contentType,
          body,
        });
      }

      options.onResponseHeaders?.(response.headers);
      const contentType = response.headers.get('content-type') ?? '';
      const body = await this.readBoundedText(response);
      if (!options.isNotification && controller.signal.aborted) {
        throw this.abortError(controller.signal);
      }
      return { contentType, body };
    } catch (error) {
      if (error instanceof McpClientError) {
        throw error;
      }
      if (controller.signal.aborted) {
        throw this.abortError(controller.signal);
      }
      throw new McpClientError('TRANSPORT_FAILED', 'MCP 请求失败', error);
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', forwardAbort);
    }
  }

  /**
   * 返回本请求允许的最大等待毫秒数：
   * - 设有 deadlineAt 时取剩余时间，<=0 立即返回 0（等价立即 TIMEOUT）；
   * - 未设 deadlineAt 时退回单请求 timeoutMs。
   */
  private remainingRequestMs(): number {
    if (this.deadlineAt !== null) {
      return Math.max(0, this.deadlineAt - Date.now());
    }
    return this.timeoutMs;
  }

  private async readBoundedText(response: Response): Promise<string> {
    // 优先流式读取（Node / expo/fetch）：超限可提前 cancel，事前阻止大响应。
    const bodyStream = response.body as ReadableStream<Uint8Array> | null | undefined;
    const reader = typeof bodyStream?.getReader === 'function' ? bodyStream.getReader() : null;
    if (reader) {
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        total += value.byteLength;
        if (total > this.maxResponseBytes) {
          await reader.cancel().catch(() => {});
          throw new McpClientError('PAYLOAD_TOO_LARGE', `MCP 响应超过 ${this.maxResponseBytes} 字节`);
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    }
    // React Native 的 fetch polyfill（基于 XMLHttpRequest）没有 response.body 流：
    // 退回 text() 一次性读取，读完后校验大小（事后检查；MCP JSON 响应场景可接受）。
    const text = await response.text();
    if (utf8ByteLength(text) > this.maxResponseBytes) {
      throw new McpClientError('PAYLOAD_TOO_LARGE', `MCP 响应超过 ${this.maxResponseBytes} 字节`);
    }
    return text;
  }

  private abortError(signal: AbortSignal): McpClientError {
    const reason = String(signal.reason ?? '');
    if (reason === MCP_TIMEOUT_ABORT_REASON) {
      return new McpClientError('TIMEOUT', `MCP 请求超过 ${this.timeoutMs} ms 未完成`);
    }
    return new McpClientError('CANCELLED', 'MCP 请求被取消');
  }
}

/** 解析响应体为匹配 expectedId 的 JSON-RPC 响应；SSE 按 event 聚合 data 查找。 */
export function parseJsonRpcResponseBody(
  contentType: string,
  body: string,
  expectedId: number | string | undefined,
  mapRpcError: JsonRpcErrorMapper
): McpJsonRpcResponse {
  const parsed = contentType.includes('text/event-stream')
    ? parseSseBody(body, expectedId, mapRpcError)
    : parseJsonBody(body, mapRpcError);
  if (parsed.id !== expectedId) {
    throw new McpClientError('PROTOCOL_ERROR', 'JSON-RPC 响应 id 与请求不匹配');
  }
  return parsed;
}

function parseJsonBody(body: string, mapRpcError: JsonRpcErrorMapper): McpJsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 响应不是合法 JSON');
  }
  return validateResponse(parsed, mapRpcError);
}

function parseSseBody(
  body: string,
  expectedId: number | string | undefined,
  mapRpcError: JsonRpcErrorMapper
): McpJsonRpcResponse {
  // SSE 的一个 event 可以包含多条 data 行；这些行必须按规范用换行拼接后
  // 才是一个 JSON-RPC message。先按 id 筛选，才能忽略同一响应流中的
  // progress/log notification 或其他请求的 response，而不把它们误判成坏响应。
  for (const payload of readSseDataEvents(body)) {
    if (!payload || payload === '[DONE]') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      // 非 JSON 的 SSE event（例如服务端扩展事件）不属于本次 JSON-RPC 响应。
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || (parsed as { id?: unknown }).id !== expectedId) {
      continue;
    }
    return validateResponse(parsed, mapRpcError);
  }
  throw new McpClientError('PROTOCOL_ERROR', 'MCP SSE 响应缺少匹配请求的消息');
}

/**
 * 将 SSE body 还原成各个 event 的 data payload。
 * SSE 允许 CRLF、CR、LF 三种换行；空行提交当前 event，EOF 也会提交最后一个 event。
 */
function readSseDataEvents(body: string): string[] {
  const events: string[] = [];
  let dataLines: string[] = [];
  const commit = (): void => {
    if (dataLines.length > 0) {
      events.push(dataLines.join('\n'));
      dataLines = [];
    }
  };

  for (const rawLine of body.split(/\r\n|\r|\n/)) {
    if (rawLine === '') {
      commit();
      continue;
    }
    // 注释行（例如 keep-alive）不影响 event 的 data 聚合。
    if (rawLine.startsWith(':')) {
      continue;
    }
    if (!rawLine.startsWith('data:')) {
      continue;
    }
    let data = rawLine.slice(5);
    // SSE 仅移除 data: 后的一个可选空格，不能 trim 掉 JSON 字符串中的空格。
    if (data.startsWith(' ')) {
      data = data.slice(1);
    }
    dataLines.push(data);
  }
  commit();
  return events;
}

/**
 * 解析 HTTP 错误体中的 JSON-RPC error，不要求 response id；握手拒绝通常
 * 由服务端在 400 body 中返回。有效 JSON 但不是 error 时标记为结构化协议
 * body，调用方不得再按空 body 解释协议时代。
 */
function parseJsonRpcErrorBody(context?: McpHttpErrorContext): McpJsonRpcErrorBody {
  if (!context || context.body.length === 0) {
    return { kind: 'unparseable' };
  }
  const payloads = context.contentType.includes('text/event-stream')
    ? readSseDataEvents(context.body)
    : [context.body];
  let sawJson = false;
  let sawJsonRpc = false;
  for (const payload of payloads) {
    if (!payload || payload === '[DONE]') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    sawJson = true;
    if (!parsed || typeof parsed !== 'object' || (parsed as { jsonrpc?: unknown }).jsonrpc !== '2.0') {
      continue;
    }
    sawJsonRpc = true;
    const candidateError = (parsed as { error?: unknown }).error;
    if (candidateError && typeof candidateError === 'object' && !Array.isArray(candidateError)) {
      const error = candidateError as { code?: unknown; message?: unknown; data?: unknown };
      return {
        kind: 'error',
        error: {
          code: typeof error.code === 'number' ? error.code : -32000,
          message: typeof error.message === 'string' ? error.message : '未知 JSON-RPC 错误',
          data: error.data,
        },
      };
    }
  }
  if (sawJsonRpc) {
    return { kind: 'jsonrpc' };
  }
  if (sawJson) {
    return { kind: 'json' };
  }
  return { kind: 'unparseable' };
}

function validateResponse(parsed: unknown, mapRpcError: JsonRpcErrorMapper): McpJsonRpcResponse {
  if (!parsed || typeof parsed !== 'object') {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 响应不是 JSON-RPC 对象');
  }
  const candidate = parsed as McpJsonRpcResponse;
  if (candidate.jsonrpc !== '2.0') {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 响应缺少 jsonrpc 2.0 标记');
  }
  if (candidate.error !== undefined) {
    const error = candidate.error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP 响应 error 不是对象');
    }
    const code = typeof error.code === 'number' ? error.code : -32000;
    const message = typeof error.message === 'string'
      ? error.message
      : '未知 JSON-RPC 错误';
    throw mapRpcError({ code, message, data: error.data });
  }
  if (candidate.result === undefined) {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 响应缺少 result');
  }
  return candidate;
}

export function requireResultObject(
  response: McpJsonRpcResponse,
  method: string
): Record<string, unknown> {
  if (!response.result || typeof response.result !== 'object' || Array.isArray(response.result)) {
    throw new McpClientError('PROTOCOL_ERROR', `${method} 响应 result 不是对象`);
  }
  return response.result as Record<string, unknown>;
}

/** 2026-07-28 结果判别字段：该协议族要求每个成功 result 明确声明 resultType。 */
export type McpResultType = 'complete' | 'input_required';

export function requireMcpResultType(
  result: Record<string, unknown>,
  method: string
): McpResultType {
  if (!Object.prototype.hasOwnProperty.call(result, 'resultType')) {
    throw new McpClientError('PROTOCOL_ERROR', `${method} 响应缺少 resultType`);
  }
  if (result.resultType === 'complete' || result.resultType === 'input_required') {
    return result.resultType;
  }
  throw new McpClientError(
    'PROTOCOL_ERROR',
    `${method} 响应包含未知 resultType：${String(result.resultType)}`
  );
}

/** discover/tools/list 不支持在当前客户端继续完成 MRTR，只接受 complete。 */
export function requireCompleteMcpResult(
  result: Record<string, unknown>,
  method: string
): void {
  const resultType = requireMcpResultType(result, method);
  if (resultType !== 'complete') {
    throw new McpClientError(
      'PROTOCOL_ERROR',
      `${method} 返回不支持的 resultType：${resultType}`
    );
  }
}

export interface McpToolsListPaginationOptions {
  maxListPages: number;
  maxListTools: number;
  signal: AbortSignal;
  /** 请求一页 tools/list；cursor 为 null 表示第一页。 */
  requestPage: (
    cursor: string | null,
    signal: AbortSignal
  ) => Promise<McpJsonRpcResponse>;
  /** 2026-07-28 要求 resultType=complete；2025 允许字段缺省。 */
  requireCompleteResult: boolean;
  /**
   * 协议族特有的工具定义校验。2026 用它排除非法 x-mcp-header 工具；
   * 2025 不传入，因而完整保留该扩展并维持 legacy 行为。
   */
  validateTool?: (tool: McpToolDefinition) => void;
}

/**
 * Legacy/Modern 共用的 tools/list 分页 owner。
 * 分页边界、cursor 防循环和数量上限属于协议传输层，不应在两个 Adapter 中各自维护。
 */
export async function listAllMcpTools(
  options: McpToolsListPaginationOptions
): Promise<McpListToolsResult> {
  const tools: McpToolDefinition[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let pageCount = 0;
  let receivedToolCount = 0;

  do {
    pageCount += 1;
    if (pageCount > options.maxListPages) {
      throw new McpClientError(
        'PROTOCOL_ERROR',
        `tools/list 超过最大页数 ${options.maxListPages}，停止分页`
      );
    }
    const response = await options.requestPage(cursor, options.signal);
    const result = requireResultObject(response, 'tools/list');
    if (options.requireCompleteResult) {
      requireCompleteMcpResult(result, 'tools/list');
    }
    const pageTools = result.tools;
    if (!Array.isArray(pageTools)) {
      throw new McpClientError('PROTOCOL_ERROR', 'tools/list 响应缺少 tools 数组');
    }
    for (const value of pageTools) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new McpClientError('PROTOCOL_ERROR', 'tools/list 响应包含非法工具项');
      }
      const tool = value as McpToolDefinition;
      if (typeof tool.name !== 'string') {
        throw new McpClientError('PROTOCOL_ERROR', 'tools/list 响应包含非法工具项');
      }
      receivedToolCount += 1;
      if (receivedToolCount > options.maxListTools) {
        throw new McpClientError(
          'PROTOCOL_ERROR',
          `tools/list 超过最大工具总数 ${options.maxListTools}`
        );
      }
      if (options.validateTool) {
        try {
          options.validateTool(tool);
        } catch (error) {
          if (!(error instanceof McpClientError)) {
            throw error;
          }
          // 单个工具的扩展 schema 属于该工具自己的边界；不应废掉同页其他合法工具。
          console.warn(
            `[MCP] tools/list 忽略工具 ${tool.name}：${error.message}`
          );
          continue;
        }
      }
      tools.push({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : undefined,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      });
    }
    const nextCursor = typeof result.nextCursor === 'string' && result.nextCursor
      ? result.nextCursor
      : null;
    if (nextCursor === null) {
      break;
    }
    if (seenCursors.has(nextCursor)) {
      throw new McpClientError('PROTOCOL_ERROR', 'tools/list 返回重复 cursor，停止分页');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (true);

  return { tools, nextCursor: null };
}

interface McpHeaderParameterDescriptor {
  name: string;
  type: 'string' | 'integer' | 'boolean';
  path: readonly string[];
}

/**
 * 读取 2026-07-28 x-mcp-header 标注的静态 properties 路径并生成 HTTP 头。
 * 该逻辑只读调用方传入的冻结 schema，不修改请求 arguments 或 schema 本身。
 */
export function buildMcpParameterHeaders(
  inputSchema: unknown,
  args: unknown
): Record<string, string> {
  const descriptors = readMcpHeaderParameterDescriptors(inputSchema);
  const headers: Record<string, string> = {};
  for (const descriptor of descriptors) {
    const value = readPathValue(args, descriptor.path);
    if (value === undefined || value === null) {
      continue;
    }
    headers[`Mcp-Param-${descriptor.name}`] = encodeMcpHeaderValue(
      stringifyMcpHeaderParameter(value, descriptor)
    );
  }
  return headers;
}

/** Mcp-Name 与 Mcp-Param-* 共用规范要求的 ASCII / Base64 sentinel 编码。 */
export function encodeMcpHeaderValue(value: string): string {
  if (isSafePlainMcpHeaderValue(value) && !isMcpBase64Sentinel(value)) {
    return value;
  }
  return `=?base64?${encodeUtf8Base64(value)}?=`;
}

function readMcpHeaderParameterDescriptors(
  inputSchema: unknown
): McpHeaderParameterDescriptor[] {
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    return [];
  }
  const descriptors: McpHeaderParameterDescriptor[] = [];
  const seenNames = new Set<string>();

  type SchemaPathStatus = 'root' | 'static_property' | 'non_static';
  const schemaMapKeywords = new Set([
    'patternProperties',
    'dependentSchemas',
    'dependencies',
    '$defs',
    'definitions',
  ]);
  const schemaArrayKeywords = new Set([
    'prefixItems',
    'oneOf',
    'anyOf',
    'allOf',
  ]);
  const schemaValueKeywords = new Set([
    'items',
    'additionalItems',
    'contains',
    'propertyNames',
    'unevaluatedItems',
    'unevaluatedProperties',
    'additionalProperties',
    'not',
    'if',
    'then',
    'else',
    '$ref',
    '$dynamicRef',
    'contentSchema',
  ]);

  const visitSchemaMap = (
    value: unknown,
    path: readonly string[],
  ): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      visit(child, path, 'non_static');
    }
  };

  const visit = (
    value: unknown,
    path: readonly string[],
    pathStatus: SchemaPathStatus
  ): void => {
    if (Array.isArray(value)) {
      // items/oneOf/allOf 等数组中的对象不属于 properties 静态路径；仍需
      // 遍历它们，避免漏掉非法 x-mcp-header 标注。
      for (const item of value) {
        visit(item, path, 'non_static');
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    const schema = value as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(schema, 'x-mcp-header')) {
      if (pathStatus !== 'static_property') {
        throw new McpClientError(
          'PROTOCOL_ERROR',
          'MCP 工具 inputSchema 的 x-mcp-header 必须位于静态 properties 属性上'
        );
      }
      const headerName = schema['x-mcp-header'];
      if (
        typeof headerName !== 'string'
        || !headerName
        || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(headerName)
      ) {
        throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 的 x-mcp-header 不是合法 HTTP 字段名');
      }
      const normalizedName = headerName.toLowerCase();
      if (seenNames.has(normalizedName)) {
        throw new McpClientError(
          'PROTOCOL_ERROR',
          `MCP 工具 inputSchema 的 x-mcp-header 重复：${headerName}`
        );
      }
      seenNames.add(normalizedName);
      const type = schema.type;
      if (type !== 'string' && type !== 'integer' && type !== 'boolean') {
        throw new McpClientError(
          'PROTOCOL_ERROR',
          `MCP 工具 inputSchema 的 x-mcp-header 参数类型不支持：${String(type)}`
        );
      }
      descriptors.push({ name: headerName, type, path });
    }

    const properties = schema.properties;
    if (properties !== undefined) {
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
        throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema.properties 不是对象');
      }
      for (const [propertyName, propertySchema] of Object.entries(properties)) {
        const propertyPathStatus = pathStatus === 'non_static'
          ? 'non_static'
          : 'static_property';
        visit(propertySchema, [...path, propertyName], propertyPathStatus);
      }
    }

    // 只沿 JSON Schema 的 schema-bearing 关键字继续扫描。default/examples/const/
    // description 以及未知扩展中的普通实例数据不能被当成 schema，否则合法的
    // 默认对象可能被误判为含有非法 x-mcp-header。
    for (const key of schemaMapKeywords) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        visitSchemaMap(schema[key], path);
      }
    }
    for (const key of schemaArrayKeywords) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        visit(schema[key], path, 'non_static');
      }
    }
    for (const key of schemaValueKeywords) {
      if (Object.prototype.hasOwnProperty.call(schema, key)) {
        visit(schema[key], path, 'non_static');
      }
    }
  };

  visit(inputSchema, [], 'root');
  return descriptors;
}

function readPathValue(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function stringifyMcpHeaderParameter(
  value: unknown,
  descriptor: McpHeaderParameterDescriptor
): string {
  if (descriptor.type === 'string') {
    if (typeof value !== 'string') {
      throw new McpClientError('PROTOCOL_ERROR', `MCP 工具参数 ${descriptor.path.join('.')} 不是 string`);
    }
    return value;
  }
  if (descriptor.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new McpClientError('PROTOCOL_ERROR', `MCP 工具参数 ${descriptor.path.join('.')} 不是 boolean`);
    }
    return value ? 'true' : 'false';
  }
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new McpClientError(
      'PROTOCOL_ERROR',
      `MCP 工具参数 ${descriptor.path.join('.')} 不是 JavaScript 安全整数`
    );
  }
  return String(value);
}

function isSafePlainMcpHeaderValue(value: string): boolean {
  if (
    (value.startsWith(' ') || value.startsWith('\t'))
    || (value.endsWith(' ') || value.endsWith('\t'))
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 0x7e || code === 0x7f || (code < 0x20 && code !== 0x09)) {
      return false;
    }
  }
  return true;
}

function isMcpBase64Sentinel(value: string): boolean {
  return value.startsWith('=?base64?') && value.endsWith('?=');
}

function encodeUtf8Base64(value: string): string {
  const bytes = utf8Encode(value);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    output += alphabet[first >> 2];
    output += alphabet[((first & 0x03) << 4) | (second >> 4)];
    output += index + 1 < bytes.length
      ? alphabet[((second & 0x0f) << 2) | (third >> 6)]
      : '=';
    output += index + 2 < bytes.length ? alphabet[third & 0x3f] : '=';
  }
  return output;
}

function utf8Encode(value: string): number[] {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(value));
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + next - 0xdc00;
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
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}

function utf8ByteLength(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return utf8Encode(value).length;
}
