/** Legacy 2025 MCP Streamable HTTP Adapter：严格协商、session 与 DELETE close。 */

import { McpClientError } from '../McpClientError';
import type { McpClientPort, McpToolCallOptions } from '../McpClientPort';
import type {
  McpConnectionInfo,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpListToolsResult,
  McpToolCallContentPart,
  McpToolCallResult,
} from '../McpProtocolTypes';
import { normalizeMcpServerInfo } from '../McpServerInfo';
import {
  JSON_RPC_ERROR_METHOD_NOT_FOUND,
  JSON_RPC_ERROR_UNSUPPORTED_PROTOCOL_VERSION,
  mapMcpHandshakeHttpError,
  mapRpcErrorToProtocolError,
  McpHttpJsonRpcTransport,
  MCP_TOOLS_LIST_DEFAULTS,
  listAllMcpTools,
  parseJsonRpcResponseBody,
  requireResultObject,
} from '../internal/httpJsonRpc';
import type {
  JsonRpcErrorMapper,
  JsonRpcWireError,
  McpHttpErrorContext,
} from '../internal/httpJsonRpc';

/** auto 以 2025-11-25 发起 initialize；缓存连接则复用冻结 revision。 */
export const MCP_PROTOCOL_VERSION_2025_11_25 = '2025-11-25';

/** 协商可接受的 legacy 协议版本：二选一，其他版本即不兼容。 */
const ACCEPTED_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-11-25'];

export interface LegacyMcpClientAdapterOptions {
  url: string;
  bearerToken?: string;
  timeoutMs?: number;
  /**
   * 整个连接测试的绝对截止时间戳（epoch ms）。
   * 覆盖 initialize、notifications/initialized 与 tools/list 全部分页；
   * 每个网络请求 timer 只使用剩余时间，不逐页重置完整预算。
   */
  deadlineAt?: number;
  /** tools/list 最大页数，超过即失败。 */
  maxListPages?: number;
  /** tools/list 最大工具总数，超过即失败。 */
  maxListTools?: number;
  /** 单次 HTTP 响应体上限（字节）。 */
  maxResponseBytes?: number;
  /** cached legacy selection；协商结果必须与它完全一致。 */
  expectedProtocolVersion?: string;
}

/** tools/list 分页与响应体上限默认值（Legacy/Modern Adapter 共用，自共享传输模块转发）。 */
export { MCP_TOOLS_LIST_DEFAULTS } from '../internal/httpJsonRpc';

export class LegacyMcpClientAdapter implements McpClientPort {
  private readonly transport: McpHttpJsonRpcTransport;
  private readonly maxListPages: number;
  private readonly maxListTools: number;
  private readonly expectedProtocolVersion: string | undefined;
  /** auto legacy negotiation proposes latest revision；cached selection复用冻结 revision。 */
  private readonly requestedProtocolVersion: string;
  private nextId = 1;
  private sessionId: string | null = null;
  private connected = false;
  private closed = false;
  private closeDeleteAttempted = false;
  /** initialize 实际协商到的协议版本；mcp-protocol-version header 与 connectionInfo 均用该值。 */
  private negotiatedProtocolVersion: string = MCP_PROTOCOL_VERSION_2025_11_25;
  /** 第一次 connect 的协商结果；后续 connect 返回同一语义的不可变副本，不丢字段。 */
  private connectionInfo: McpConnectionInfo | null = null;

  constructor(options: LegacyMcpClientAdapterOptions) {
    this.transport = new McpHttpJsonRpcTransport({
      url: options.url,
      bearerToken: options.bearerToken,
      timeoutMs: options.timeoutMs ?? MCP_TOOLS_LIST_DEFAULTS.defaultTimeoutMs,
      deadlineAt: options.deadlineAt ?? null,
      maxResponseBytes: options.maxResponseBytes ?? MCP_TOOLS_LIST_DEFAULTS.maxResponseBytes,
    });
    this.maxListPages = options.maxListPages ?? MCP_TOOLS_LIST_DEFAULTS.maxListPages;
    this.maxListTools = options.maxListTools ?? MCP_TOOLS_LIST_DEFAULTS.maxListTools;
    this.expectedProtocolVersion = options.expectedProtocolVersion;
    this.requestedProtocolVersion = options.expectedProtocolVersion ?? MCP_PROTOCOL_VERSION_2025_11_25;
  }

  async connect(signal: AbortSignal): Promise<McpConnectionInfo> {
    this.assertOpen();
    if (this.connected) {
      // 幂等：返回第一次协商结果的不可变副本，不重复 initialize，也不丢字段。
      return this.copyConnectionInfo(this.connectionInfo);
    }
    // 上一次连接尝试若在 initialized notification 处失败，不得把旧 session 带入新的 initialize。
    this.sessionId = null;
    const response = await this.post(
      'initialize',
      {
        protocolVersion: this.requestedProtocolVersion,
        capabilities: {},
        clientInfo: { name: 'kimiphone', version: '2.0.0' },
      },
      signal,
      // initialize 的拒绝信号只表达当前 Legacy 握手或 revision 不被接受；
      // NegotiatingMcpClient 不会消费它去跨 era 重试。
      { mapHttpError: mapInitializeHttpError, mapRpcError: mapInitializeRpcError }
    );

    const result = requireResultObject(response, 'initialize');
    const negotiated = result.protocolVersion;
    if (typeof negotiated !== 'string' || !ACCEPTED_PROTOCOL_VERSIONS.includes(negotiated)) {
      throw new McpClientError(
        'PROTOCOL_VERSION_UNSUPPORTED',
        `MCP Server 返回不支持的协议版本：${String(negotiated)}；本应用仅支持 2025-06-18 与 2025-11-25，不静默降级`
      );
    }
    if (
      this.expectedProtocolVersion !== undefined
      && negotiated !== this.expectedProtocolVersion
    ) {
      throw new McpClientError(
        'PROTOCOL_VERSION_UNSUPPORTED',
        `MCP Server 当前协商到 ${negotiated}，与缓存的 legacy revision ${this.expectedProtocolVersion} 不一致；请重新测试连接`
      );
    }
    this.negotiatedProtocolVersion = negotiated;
    const serverInfo = normalizeMcpServerInfo(result.serverInfo);
    const connectionInfo = this.buildConnectionInfo(serverInfo, result);

    // initialize 成功后发送 notifications/initialized；notification 不等待 JSON-RPC result。
    try {
      await this.postNotification('notifications/initialized', {}, signal);
    } catch (error) {
      // notification 失败时连接协商未提交，清除本次 initialize 返回的 session，允许后续重新连接。
      this.sessionId = null;
      throw error;
    }

    this.connectionInfo = connectionInfo;
    this.connected = true;
    return this.copyConnectionInfo(this.connectionInfo);
  }

  /** 遍历 tools/list 全部分页，直到无 nextCursor；任一失败都不返回部分成功结果。 */
  async listAllTools(signal: AbortSignal): Promise<McpListToolsResult> {
    this.assertOpen();
    this.assertConnected();
    return listAllMcpTools({
      maxListPages: this.maxListPages,
      maxListTools: this.maxListTools,
      signal,
      requireCompleteResult: false,
      requestPage: (cursor, requestSignal) => this.post(
        'tools/list',
        cursor === null ? {} : { cursor },
        requestSignal
      ),
    });
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (!this.closeDeleteAttempted) {
      this.closeDeleteAttempted = true;
      if (this.connected && this.sessionId !== null) {
        try {
          await this.sendDeleteClose();
        } catch {
          // close 失败不得覆盖此前更重要的连接测试错误；此处尽力而为，不重试。
        }
      }
    }
    this.closed = true;
  }

  /** 供连接测试确认 DELETE close 行为可验证。 */
  get didAttemptSessionDelete(): boolean {
    return this.closeDeleteAttempted && this.connected && this.sessionId !== null;
  }

  /** 通用 Port 已含 callTool；未 connect 前调用必须明确失败。 */
  async callTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
    _options: McpToolCallOptions
  ): Promise<McpToolCallResult> {
    this.assertOpen();
    this.assertConnected();
    const response = await this.post('tools/call', { name, arguments: args }, signal);
    const result = requireResultObject(response, 'tools/call');
    if (!Array.isArray(result.content)) {
      throw new McpClientError('PROTOCOL_ERROR', 'tools/call 响应缺少 content 数组');
    }
    return {
      content: result.content as McpToolCallContentPart[],
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    };
  }

  private async sendDeleteClose(): Promise<void> {
    await this.transport.delete({ headers: this.requestHeaders() });
  }

  private async postNotification(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<void> {
    await this.transportRequest({ jsonrpc: '2.0', method, params }, signal, true, undefined, true);
  }

  private async post(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    errorMappers?: {
      mapHttpError?: (status: number, context?: McpHttpErrorContext) => McpClientError;
      mapRpcError?: JsonRpcErrorMapper;
    }
  ): Promise<McpJsonRpcResponse> {
    const request: McpJsonRpcRequest = { jsonrpc: '2.0', id: this.nextId++, method, params };
    return this.transportRequest(request, signal, false, errorMappers);
  }

  private async transportRequest(
    request: McpJsonRpcRequest,
    signal: AbortSignal,
    isNotification: boolean,
    errorMappers?: {
      mapHttpError?: (status: number, context?: McpHttpErrorContext) => McpClientError;
      mapRpcError?: JsonRpcErrorMapper;
    },
    includeProtocolVersion = false
  ): Promise<McpJsonRpcResponse> {
    const { contentType, body } = await this.transport.postJson(request, {
      headers: this.requestHeaders(includeProtocolVersion),
      signal,
      isNotification,
      onResponseHeaders: (headers) => this.captureSessionHeader(headers),
      mapHttpError: errorMappers?.mapHttpError,
    });
    if (isNotification) {
      // notification 不等待 JSON-RPC result；读完即完成。
      return { jsonrpc: '2.0', id: null };
    }
    return parseJsonRpcResponseBody(
      contentType,
      body,
      request.id,
      errorMappers?.mapRpcError ?? mapRpcErrorToProtocolError
    );
  }

  /** Mcp-Session-Id 只保存在当前连接对象内，不进入 SQLite、快照、日志或事件。 */
  private captureSessionHeader(headers: Headers): void {
    const sessionHeader = headers.get('mcp-session-id');
    if (sessionHeader && sessionHeader.length > 0) {
      this.sessionId = sessionHeader;
    }
  }

  private requestHeaders(includeProtocolVersion = false): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    };
    if (this.connected || includeProtocolVersion) {
      headers['mcp-protocol-version'] = this.negotiatedProtocolVersion;
    }
    if (this.sessionId !== null) {
      headers['mcp-session-id'] = this.sessionId;
    }
    return headers;
  }

  private buildConnectionInfo(
    serverInfo: { name: string; version: string } | null = null,
    result: Record<string, unknown> = {}
  ): McpConnectionInfo {
    return {
      protocolVersion: this.negotiatedProtocolVersion,
      protocolEra: 'legacy',
      serverInfo,
      capabilities: result.capabilities && typeof result.capabilities === 'object'
        ? result.capabilities as Record<string, unknown>
        : {},
    };
  }

  private copyConnectionInfo(info: McpConnectionInfo | null): McpConnectionInfo {
    if (!info) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP client 尚未完成 initialize');
    }
    return {
      protocolVersion: info.protocolVersion,
      protocolEra: info.protocolEra,
      serverInfo: info.serverInfo === null
        ? null
        : { name: info.serverInfo.name, version: info.serverInfo.version },
      capabilities: { ...info.capabilities },
    };
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new McpClientError('TRANSPORT_FAILED', 'MCP client 已关闭');
    }
  }

  private assertConnected(): void {
    if (!this.connected) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP client 尚未完成 initialize');
    }
  }
}

/**
 * initialize 的 HTTP 拒绝映射：先解析有界 JSON-RPC body，保留 Server 的
 * 协议错误语义；仅完全没有结构化 body 的 400/404/405 映射为不支持握手。
 * 该错误不会触发另一个 era 的隐式重试；401/403 仍为 AUTH_REQUIRED。
 */
function mapInitializeHttpError(
  status: number,
  context?: McpHttpErrorContext
): McpClientError {
  return mapMcpHandshakeHttpError(
    status,
    context,
    'MCP Server 不支持当前 Legacy initialize',
    mapInitializeRpcError
  );
}

/**
 * initialize 的 JSON-RPC error 映射：这些错误表示当前 initialize 握手或
 * revision 不被 Server 接受；它们只在本次 Legacy 连接内保持 typed error。
 */
function mapInitializeRpcError(error: JsonRpcWireError): McpClientError {
  if (
    error.code === JSON_RPC_ERROR_METHOD_NOT_FOUND
    || error.code === JSON_RPC_ERROR_UNSUPPORTED_PROTOCOL_VERSION
    || error.code === -32602
    || error.code === -32002
  ) {
    return new McpClientError(
      'PROTOCOL_VERSION_UNSUPPORTED',
       `MCP Server 不支持当前 Legacy initialize（JSON-RPC ${error.code}：${error.message}）`
    );
  }
  return mapRpcErrorToProtocolError(error);
}
