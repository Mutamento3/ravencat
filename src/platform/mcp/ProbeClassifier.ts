/**
 * server/discover 探测结果的纯分类器。
 *
 * 这里是 era negotiation 的唯一错误分类 owner：分类器不发请求、不维护重试状态，
 * 调用方只负责把一次 corrective 结果再发送一次，并在第二次拒绝时终止。
 */

import { McpClientError } from './McpClientError';

/** 当前客户端能够发送的 modern revision，按协商优先级排列。 */
export const MCP_MODERN_PROTOCOL_VERSIONS = ['2026-07-28'] as const;

/** modern era 从该 revision 开始；ISO 日期字符串可直接按字典序比较。 */
const FIRST_MODERN_PROTOCOL_VERSION = '2026-07-28';

/** MCP 2026 UnsupportedProtocolVersionError。 */
export const JSON_RPC_ERROR_UNSUPPORTED_PROTOCOL_VERSION = -32_022;

/**
 * 连接层归一化后的单次 probe 结果。
 * HTTP 4xx 的 body 保留原文，由 classifier 自己判断 JSON-RPC error；其他传输失败
 * 不应被调用方转换成 legacy 证据。
 */
export type ProbeOutcome =
  | { kind: 'result'; result: unknown }
  | { kind: 'rpc-error'; code: number; message: string; data?: unknown }
  | { kind: 'http-error'; status: number; body?: string }
  | { kind: 'network-error'; error: unknown }
  | { kind: 'auth-required'; error: Error }
  | { kind: 'closed' }
  | { kind: 'timeout'; timeoutMs: number }
  | { kind: 'cancelled'; error?: Error };

export interface ProbeClassifierContext {
  /** 客户端可协商的 modern revision；不得为空。 */
  clientModernVersions: readonly string[];
  /** 本次 probe envelope 携带的 revision，用于构造拒绝诊断。 */
  requestedVersion: string;
  /** 是否存在 legacy initialize fallback；RavenCat auto 模式始终为 true。 */
  fallbackAvailable: boolean;
}

export type ProbeVerdict =
  | { kind: 'modern'; version: string; discover: unknown }
  | { kind: 'corrective'; version: string; error: McpClientError }
  | { kind: 'legacy' }
  | { kind: 'error'; error: Error };

const NOT_PROBE_RECOGNIZED = new Set([-32_001, -32_020, -32_021]);

/**
 * 按官方 TypeScript SDK 的四态语义分类一次 probe。
 *
 * 对 HTTP 来说，只有 4xx rejection 可以成为 legacy 证据；401/403、5xx、网络、
 * timeout、close、cancel 都是连接错误。未识别的 JSON-RPC error 属于保守 legacy，
 * 只有 -32022 携带合法现代版本列表时才可能进入 corrective/error。
 */
export function classifyProbeOutcome(
  outcome: ProbeOutcome,
  context: ProbeClassifierContext
): ProbeVerdict {
  switch (outcome.kind) {
    case 'result':
      return classifyResult(outcome.result, context);
    case 'rpc-error':
      return classifyRpcError(outcome, context);
    case 'http-error':
      return classifyHttpError(outcome, context);
    case 'network-error':
      return {
        kind: 'error',
        error: asTransportError(outcome.error, 'MCP 版本探测网络失败'),
      };
    case 'auth-required':
      return { kind: 'error', error: outcome.error };
    case 'closed':
      return {
        kind: 'error',
        error: new McpClientError('TRANSPORT_FAILED', 'MCP 版本探测连接被关闭'),
      };
    case 'timeout':
      return {
        kind: 'error',
        error: new McpClientError(
          'TIMEOUT',
          `MCP 版本探测超过 ${outcome.timeoutMs} ms 未完成`
        ),
      };
    case 'cancelled':
      return {
        kind: 'error',
        error: outcome.error ?? new McpClientError('CANCELLED', 'MCP 版本探测被取消'),
      };
  }
}

/** 更明确的 platform 命名；保留官方 classifier 名称便于对照规范。 */
export const classifyMcpProbeOutcome = classifyProbeOutcome;

function classifyResult(
  result: unknown,
  context: ProbeClassifierContext
): ProbeVerdict {
  const discover = validateModernDiscoverResult(result);
  if (discover === null) {
    return { kind: 'legacy' };
  }
  const supportedVersions = discover.supportedVersions;
  const overlap = context.clientModernVersions.find((version) => supportedVersions.includes(version));
  if (overlap !== undefined) {
    return { kind: 'modern', version: overlap, discover };
  }
  if (context.fallbackAvailable) {
    return { kind: 'legacy' };
  }
  return {
    kind: 'error',
    error: unsupportedVersionError(
      `MCP Server 未声明客户端支持的 modern revision（supported=${JSON.stringify(supportedVersions)}）`,
      supportedVersions,
      context.requestedVersion
    ),
  };
}

function classifyRpcError(
  outcome: Extract<ProbeOutcome, { kind: 'rpc-error' }>,
  context: ProbeClassifierContext
): ProbeVerdict {
  if (outcome.code !== JSON_RPC_ERROR_UNSUPPORTED_PROTOCOL_VERSION) {
    // -32020/-32021 以及所有其他 code 都不是 modern era evidence。
    // 显式列出保留集合是为了记录官方语义，分类结果仍统一为 legacy。
    if (NOT_PROBE_RECOGNIZED.has(outcome.code)) {
      return { kind: 'legacy' };
    }
    return { kind: 'legacy' };
  }

  const supported = parseSupportedList(outcome.data);
  if (supported === undefined) {
    return { kind: 'legacy' };
  }

  const supportedModern = supported.filter(isModernRevision);
  const mutual = context.clientModernVersions.find((version) => supportedModern.includes(version));
  const error = unsupportedVersionError(
    `MCP Server 拒绝 modern revision ${context.requestedVersion}：${outcome.message}`,
    supported,
    parseRequested(outcome.data) ?? context.requestedVersion
  );
  if (mutual !== undefined) {
    return { kind: 'corrective', version: mutual, error };
  }
  if (supportedModern.length > 0) {
    // Server 明确属于 modern，但双方没有共同 revision；不能退回 legacy。
    return { kind: 'error', error };
  }
  return context.fallbackAvailable
    ? { kind: 'legacy' }
    : { kind: 'error', error };
}

function classifyHttpError(
  outcome: Extract<ProbeOutcome, { kind: 'http-error' }>,
  context: ProbeClassifierContext
): ProbeVerdict {
  if (outcome.status === 401 || outcome.status === 403) {
    return {
      kind: 'error',
      error: new McpClientError(
        'AUTH_REQUIRED',
        `MCP 版本探测认证失败（HTTP ${outcome.status}）`
      ),
    };
  }
  if (outcome.status >= 500) {
    return {
      kind: 'error',
      error: new McpClientError(
        'HTTP_ERROR',
        `MCP 版本探测服务端失败（HTTP ${outcome.status}）`
      ),
    };
  }

  // HTTP 4xx body 是旧服务拒绝未知 server/discover 方法时唯一可靠的 legacy 证据。
  const rpcError = parseJsonRpcErrorBody(outcome.body);
  if (rpcError !== undefined) {
    return classifyRpcError(rpcError, context);
  }
  if (outcome.status >= 400 && outcome.status < 500) {
    return { kind: 'legacy' };
  }
  return {
    kind: 'error',
    error: new McpClientError('HTTP_ERROR', `MCP 版本探测返回 HTTP ${outcome.status}`),
  };
}

function parseJsonRpcErrorBody(
  body: string | undefined
): Extract<ProbeOutcome, { kind: 'rpc-error' }> | undefined {
  if (!body) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const rpcError = (parsed as { error?: unknown }).error;
  if (!rpcError || typeof rpcError !== 'object' || Array.isArray(rpcError)) {
    return undefined;
  }
  const value = rpcError as { code?: unknown; message?: unknown; data?: unknown };
  if (typeof value.code !== 'number') {
    return undefined;
  }
  return {
    kind: 'rpc-error',
    code: value.code,
    message: typeof value.message === 'string' ? value.message : '未知 JSON-RPC 错误',
    data: value.data,
  };
}

function parseSupportedList(data: unknown): string[] | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const supported = (data as { supported?: unknown }).supported;
  if (
    !Array.isArray(supported)
    || supported.length === 0
    || !supported.every((version) => typeof version === 'string')
  ) {
    return undefined;
  }
  return supported as string[];
}

function parseRequested(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return undefined;
  }
  const requested = (data as { requested?: unknown }).requested;
  return typeof requested === 'string' ? requested : undefined;
}

function isModernRevision(version: string): boolean {
  return version >= FIRST_MODERN_PROTOCOL_VERSION;
}

interface ValidatedModernDiscoverResult extends Record<string, unknown> {
  supportedVersions: string[];
  capabilities: Record<string, unknown>;
  instructions?: string;
  _meta?: Record<string, unknown>;
}

/**
 * RavenCat 使用到的 2026 DiscoverResult 最小 wire validator。
 * 已知字段严格校验，未知扩展字段原样保留；不在这里建设通用 schema runtime。
 * resultType 缺失按 complete 接收；ttlMs / cacheScope 保持官方 receiver-side leniency。
 */
function validateModernDiscoverResult(result: unknown): ValidatedModernDiscoverResult | null {
  if (!isRecord(result)) {
    return null;
  }
  const supportedVersions = result.supportedVersions;
  if (
    !Array.isArray(supportedVersions)
    || supportedVersions.length === 0
    || !supportedVersions.every((version) => typeof version === 'string')
    || !validateServerCapabilities2026(result.capabilities)
  ) {
    return null;
  }
  if (result.resultType !== undefined && typeof result.resultType !== 'string') {
    return null;
  }
  if (result.instructions !== undefined && typeof result.instructions !== 'string') {
    return null;
  }
  if (result._meta !== undefined && !isRecord(result._meta)) {
    return null;
  }
  return result as ValidatedModernDiscoverResult;
}

/**
 * 2026 ServerCapabilities 是开放对象：只校验规范已知 key，未知 capability 继续透传。
 */
function validateServerCapabilities2026(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  for (const key of ['logging', 'completions'] as const) {
    if (value[key] !== undefined && !isRecord(value[key])) {
      return false;
    }
  }
  for (const key of ['prompts', 'tools'] as const) {
    const capability = value[key];
    if (
      capability !== undefined
      && (
        !isRecord(capability)
        || (capability.listChanged !== undefined && typeof capability.listChanged !== 'boolean')
      )
    ) {
      return false;
    }
  }
  const resources = value.resources;
  if (
    resources !== undefined
    && (
      !isRecord(resources)
      || (resources.subscribe !== undefined && typeof resources.subscribe !== 'boolean')
      || (resources.listChanged !== undefined && typeof resources.listChanged !== 'boolean')
    )
  ) {
    return false;
  }
  for (const key of ['experimental', 'extensions'] as const) {
    const entries = value[key];
    if (
      entries !== undefined
      && (
        !isRecord(entries)
        || !Object.values(entries).every(isRecord)
      )
    ) {
      return false;
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unsupportedVersionError(
  message: string,
  supported: readonly string[],
  requested: string
): McpClientError {
  return new McpClientError(
    'PROTOCOL_VERSION_UNSUPPORTED',
    `${message}；requested=${requested}；supported=${JSON.stringify(supported)}`
  );
}

function asTransportError(error: unknown, message: string): Error {
  if (error instanceof Error) {
    return error;
  }
  return new McpClientError('TRANSPORT_FAILED', message, error);
}
