/** Modern 2026-07-28 MCP Adapter：无 initialize/session，每请求 _meta 携带协议版本与客户端身份。 */

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
  mapRpcErrorToProtocolError,
  mapHttpStatusToHttpError,
  McpHttpJsonRpcTransport,
  MCP_TOOLS_LIST_DEFAULTS,
  buildMcpParameterHeaders,
  encodeMcpHeaderValue,
  listAllMcpTools,
  parseJsonRpcResponseBody,
  readMatchingJsonRpcError,
  requireMcpResultType,
  requireResultObject,
} from '../internal/httpJsonRpc';
import type { JsonRpcWireError } from '../internal/httpJsonRpc';
import {
  classifyProbeOutcome,
  MCP_MODERN_PROTOCOL_VERSIONS,
} from '../ProbeClassifier';
import type { ProbeVerdict } from '../ProbeClassifier';

/** 本 Adapter 只说 modern 2026-07-28 协议；server/discover 未声明该版本即不兼容。 */
export const MCP_PROTOCOL_VERSION_2026_07_28 = '2026-07-28';

/** Modern per-request _meta 的官方 key（2026-07-28 规范）。 */
const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
const META_CLIENT_INFO = 'io.modelcontextprotocol/clientInfo';
const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export interface ModernMcpClientAdapterOptions {
  url: string;
  bearerToken?: string;
  timeoutMs?: number;
  /**
   * 整个连接测试的绝对截止时间戳（epoch ms）。
   * 覆盖 server/discover 与 tools/list 全部分页；
   * 每个网络请求 timer 只使用剩余时间，不逐页重置完整预算。
   */
  deadlineAt?: number;
  /** tools/list 最大页数，超过即失败。 */
  maxListPages?: number;
  /** tools/list 最大工具总数，超过即失败。 */
  maxListTools?: number;
  /** 单次 HTTP 响应体上限（字节）。 */
  maxResponseBytes?: number;
  /** 缓存的 modern 选择：跳过 server/discover，直接采用该 adapter。 */
  assumeConnected?: boolean;
  /** 缓存的 modern revision；未提供时使用当前唯一支持的 revision。 */
  protocolVersion?: string;
}

export class ModernMcpClientAdapter implements McpClientPort {
  private readonly transport: McpHttpJsonRpcTransport;
  private readonly maxListPages: number;
  private readonly maxListTools: number;
  private nextId = 1;
  private connected = false;
  private closed = false;
  /** 第一次 connect 的协商结果；后续 connect 返回同一语义的不可变副本，不丢字段。 */
  private connectionInfo: McpConnectionInfo | null = null;
  private readonly assumeConnected: boolean;
  private protocolVersion: string;
  private readonly timeoutMs: number;

  constructor(options: ModernMcpClientAdapterOptions) {
    this.assumeConnected = options.assumeConnected === true;
    this.protocolVersion = options.protocolVersion ?? MCP_PROTOCOL_VERSION_2026_07_28;
    this.timeoutMs = options.timeoutMs ?? MCP_TOOLS_LIST_DEFAULTS.defaultTimeoutMs;
    if (!MCP_MODERN_PROTOCOL_VERSIONS.includes(this.protocolVersion as typeof MCP_MODERN_PROTOCOL_VERSIONS[number])) {
      throw new McpClientError(
        'PROTOCOL_VERSION_UNSUPPORTED',
        `Modern MCP revision 不受支持：${this.protocolVersion}`
      );
    }
    this.transport = new McpHttpJsonRpcTransport({
      url: options.url,
      bearerToken: options.bearerToken,
      timeoutMs: this.timeoutMs,
      deadlineAt: options.deadlineAt ?? null,
      maxResponseBytes: options.maxResponseBytes ?? MCP_TOOLS_LIST_DEFAULTS.maxResponseBytes,
    });
    this.maxListPages = options.maxListPages ?? MCP_TOOLS_LIST_DEFAULTS.maxListPages;
    this.maxListTools = options.maxListTools ?? MCP_TOOLS_LIST_DEFAULTS.maxListTools;
  }

  /** Modern 连接：auto 模式执行 server/discover；cached modern 直接采用既有选择。 */
  async connect(signal: AbortSignal): Promise<McpConnectionInfo> {
    this.assertOpen();
    if (this.connected) {
      // 幂等：返回第一次协商结果的不可变副本，不重复 server/discover，也不丢字段。
      return this.copyConnectionInfo(this.connectionInfo);
    }
    if (this.assumeConnected) {
      this.connectionInfo = {
        protocolVersion: this.protocolVersion,
        protocolEra: 'modern',
        serverInfo: null,
        capabilities: {},
      };
      this.connected = true;
      return this.copyConnectionInfo(this.connectionInfo);
    }
    const result = await this.probeWithCorrections(signal);
    const resultMeta = result._meta && typeof result._meta === 'object'
      ? result._meta as Record<string, unknown>
      : {};
    const serverInfo = normalizeMcpServerInfo(resultMeta[META_SERVER_INFO]);
    this.connectionInfo = {
      protocolVersion: this.protocolVersion,
      protocolEra: 'modern',
      serverInfo,
      capabilities: result.capabilities && typeof result.capabilities === 'object'
        ? result.capabilities as Record<string, unknown>
        : {},
    };
    this.connected = true;
    return this.copyConnectionInfo(this.connectionInfo);
  }

  /**
   * 执行一次 modern probe；corrective 只允许进入一次第二次 probe。
   * 第二次返回 legacy 或 corrective 都是 modern 协商失败，不得转交 Legacy adapter。
   */
  private async probeWithCorrections(signal: AbortSignal): Promise<Record<string, unknown>> {
    const first = await this.runProbe(signal, this.protocolVersion);
    if (first.kind === 'corrective') {
      const second = await this.runProbe(signal, first.version);
      if (second.kind !== 'modern') {
        if (second.kind === 'error') {
          throw second.error;
        }
        throw new McpClientError(
          'PROTOCOL_VERSION_UNSUPPORTED',
          `MCP Server 在 corrective probe 后仍未接受 modern revision ${first.version}`
        );
      }
      this.protocolVersion = second.version;
      return asDiscoverResult(second.discover);
    }
    if (first.kind === 'legacy') {
      throw new ModernProbeLegacyError();
    }
    if (first.kind === 'error') {
      throw first.error;
    }
    this.protocolVersion = first.version;
    return asDiscoverResult(first.discover);
  }

  private async runProbe(signal: AbortSignal, protocolVersion: string): Promise<ProbeVerdict> {
    const request: McpJsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.nextId++,
      method: 'server/discover',
      params: { _meta: this.requestMeta(protocolVersion) },
    };
    try {
      const { contentType, body } = await this.transport.postJson(request, {
        headers: this.requestHeaders('server/discover', undefined, undefined, undefined, protocolVersion),
        signal,
        mapHttpError: (status, context) => new ModernProbeHttpError(status, context?.body),
      });
      let response: McpJsonRpcResponse;
      try {
        response = parseJsonRpcResponseBody(
          contentType,
          body,
          request.id,
          (error) => new ModernProbeRpcError(error)
        );
      } catch (error) {
        if (error instanceof ModernProbeRpcError) {
          return classifyProbeOutcome(
            { kind: 'rpc-error', code: error.rpcError.code, message: error.rpcError.message, data: error.rpcError.data },
            this.probeContext(protocolVersion)
          );
        }
        return { kind: 'error', error: asProbeError(error) };
      }
      return classifyProbeOutcome(
        { kind: 'result', result: response.result },
        this.probeContext(protocolVersion)
      );
    } catch (error) {
      if (error instanceof ModernProbeHttpError) {
        return classifyProbeOutcome(
          { kind: 'http-error', status: error.status, body: error.body },
          this.probeContext(protocolVersion)
        );
      }
      if (error instanceof ModernProbeRpcError) {
        return classifyProbeOutcome(
          { kind: 'rpc-error', code: error.rpcError.code, message: error.rpcError.message, data: error.rpcError.data },
          this.probeContext(protocolVersion)
        );
      }
      if (error instanceof McpClientError) {
        if (error.code === 'AUTH_REQUIRED') {
          return classifyProbeOutcome({ kind: 'auth-required', error }, this.probeContext(protocolVersion));
        }
        if (error.code === 'TIMEOUT') {
          return classifyProbeOutcome(
            { kind: 'timeout', timeoutMs: this.timeoutMs },
            this.probeContext(protocolVersion)
          );
        }
        if (error.code === 'CANCELLED') {
          return classifyProbeOutcome({ kind: 'cancelled', error }, this.probeContext(protocolVersion));
        }
        if (error.code === 'TRANSPORT_FAILED') {
          return classifyProbeOutcome({ kind: 'network-error', error }, this.probeContext(protocolVersion));
        }
        return { kind: 'error', error };
      }
      return classifyProbeOutcome(
        { kind: 'network-error', error },
        this.probeContext(protocolVersion)
      );
    }
  }

  private probeContext(requestedVersion: string): {
    clientModernVersions: readonly string[];
    requestedVersion: string;
    fallbackAvailable: true;
  } {
    return {
      clientModernVersions: MCP_MODERN_PROTOCOL_VERSIONS,
      requestedVersion,
      fallbackAvailable: true,
    };
  }

  /** 遍历 tools/list 全部分页，直到无 nextCursor；任一失败都不返回部分成功结果。 */
  async listAllTools(signal: AbortSignal): Promise<McpListToolsResult> {
    this.assertOpen();
    this.assertConnected();
    return listAllMcpTools({
      maxListPages: this.maxListPages,
      maxListTools: this.maxListTools,
      signal,
      requireCompleteResult: true,
      // 2026 Streamable HTTP 必须在发现阶段排除非法 x-mcp-header 工具；
      // 分页 owner 会逐项警告并保留同页其他合法工具。2025 Adapter 不传此校验。
      validateTool: (tool) => {
        buildMcpParameterHeaders(tool.inputSchema, undefined);
      },
      requestPage: (cursor, requestSignal) => this.post(
        'tools/list',
        cursor === null
          ? { _meta: this.requestMeta() }
          : { cursor, _meta: this.requestMeta() },
        requestSignal
      ),
    });
  }

  /** resultType=input_required 属于多轮请求（MRTR）中间结果；本客户端不支持交互式输入。 */
  async callTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
    options: McpToolCallOptions
  ): Promise<McpToolCallResult> {
    this.assertOpen();
    this.assertConnected();
    const response = await this.post(
      'tools/call',
      { name, arguments: args, _meta: this.requestMeta() },
      signal,
      name,
      options.inputSchema,
      args
    );
    const result = requireResultObject(response, 'tools/call');
    const resultType = requireMcpResultType(result, 'tools/call');
    if (resultType === 'input_required') {
      if (result.inputRequests === undefined && result.requestState === undefined) {
        throw new McpClientError('PROTOCOL_ERROR', 'tools/call input_required 响应缺少 inputRequests/requestState');
      }
      throw new McpClientError(
        'MRTR_INPUT_REQUIRED',
        `工具 ${name} 返回 resultType=input_required：该工具需要交互式输入（多轮请求），本客户端不支持`
      );
    }
    if (!Array.isArray(result.content)) {
      throw new McpClientError('PROTOCOL_ERROR', 'tools/call 响应缺少 content 数组');
    }
    return {
      content: result.content as McpToolCallContentPart[],
      structuredContent: result.structuredContent,
      isError: result.isError === true,
    };
  }

  /** Modern 协议没有 session，close 无需 DELETE；直接标记关闭，幂等。 */
  async close(): Promise<void> {
    this.closed = true;
  }

  private async post(
    method: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    name?: string,
    inputSchema?: unknown,
    args?: unknown
  ): Promise<McpJsonRpcResponse> {
    const requestId = this.nextId++;
    const request: McpJsonRpcRequest = { jsonrpc: '2.0', id: requestId, method, params };
    const { contentType, body } = await this.transport.postJson(request, {
      headers: this.requestHeaders(method, name, inputSchema, args),
      signal,
      mapHttpError: (status, context) => {
        if (status === 400) {
          const rpcError = readMatchingJsonRpcError(context, requestId);
          if (rpcError !== null) {
            return mapRpcErrorToProtocolError(rpcError);
          }
        }
        return mapHttpStatusToHttpError(status, context);
      },
    });
    return parseJsonRpcResponseBody(contentType, body, request.id, mapRpcErrorToProtocolError);
  }

  /** 2026-07-28 modern 协议：每个请求都在 params._meta 携带协议版本、客户端身份与能力。 */
  private requestMeta(protocolVersion = this.protocolVersion): Record<string, unknown> {
    return {
      [META_PROTOCOL_VERSION]: protocolVersion,
      [META_CLIENT_INFO]: { name: 'kimiphone', version: '2.0.0' },
      [META_CLIENT_CAPABILITIES]: {},
    };
  }

  /**
   * 2026-07-28 路由头契约（官方 mcp 2.x SDK 实测，规范 transports 章节）：
   * - Mcp-Protocol-Version：必须与 envelope _meta 里的 protocolVersion 严格相等；
   * - Mcp-Method：必须镜像请求体 method，缺失或不匹配返回 -32020 HEADER_MISMATCH；
   * - Mcp-Name：name-bearing 方法（tools/call 等）必须镜像 params.name/uri，
   *   非安全 ASCII 值使用规范 Base64 sentinel 编码；tools/call 额外镜像
   *   冻结 inputSchema 中的 x-mcp-header 参数。
   */
  private requestHeaders(
    method: string,
    name?: string,
    inputSchema?: unknown,
    args?: unknown,
    protocolVersion = this.protocolVersion
  ): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': protocolVersion,
      'mcp-method': method,
    };
    if (name !== undefined) {
      headers['mcp-name'] = encodeMcpHeaderValue(name);
    }
    if (method === 'tools/call') {
      Object.assign(headers, buildMcpParameterHeaders(inputSchema, args));
    }
    return headers;
  }

  private copyConnectionInfo(info: McpConnectionInfo | null): McpConnectionInfo {
    if (!info) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP client 尚未完成 server/discover');
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
      throw new McpClientError('PROTOCOL_ERROR', 'MCP client 尚未完成 server/discover');
    }
  }
}

/** Modern probe 识别为 legacy 时的内部控制信号；只允许 auto 协商 owner 消费。 */
class ModernProbeLegacyError extends McpClientError {
  readonly requiresLegacy = true;

  constructor() {
    super('PROTOCOL_VERSION_UNSUPPORTED', 'MCP Server 未提供 modern 协议证据，应执行 legacy initialize');
    this.name = 'ModernProbeLegacyError';
  }
}

export function isModernProbeLegacyError(error: unknown): error is ModernProbeLegacyError {
  return error instanceof ModernProbeLegacyError;
}

class ModernProbeHttpError extends McpClientError {
  readonly status: number;
  readonly body: string | undefined;

  constructor(status: number, body?: string) {
    super('HTTP_ERROR', `MCP modern probe 返回 HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

class ModernProbeRpcError extends McpClientError {
  readonly rpcError: JsonRpcWireError;

  constructor(error: JsonRpcWireError) {
    super('PROTOCOL_ERROR', `MCP modern probe 返回 JSON-RPC ${error.code}：${error.message}`);
    this.rpcError = error;
  }
}

function asDiscoverResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new McpClientError('PROTOCOL_ERROR', 'server/discover result 不是对象');
  }
  return result as Record<string, unknown>;
}

function asProbeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new McpClientError('PROTOCOL_ERROR', `MCP modern probe 响应解析失败：${String(error)}`);
}
