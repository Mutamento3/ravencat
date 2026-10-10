/** MCP Streamable HTTP 客户端使用的 JSON-RPC 与工具发现类型。 */

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: unknown;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export interface McpListToolsResult {
  tools: McpToolDefinition[];
  nextCursor?: string | null;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

export interface McpToolCallContentPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface McpToolCallResult {
  content: McpToolCallContentPart[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** MCP wire protocol 时代；legacy 内部再协商精确的 2025 revision。 */
export type McpProtocolEra = 'legacy' | 'modern';

/** 连接成功后可缓存的精确协议选择；运行期不跨 era 静默切换。 */
export interface McpProtocolSelection {
  protocolEra: McpProtocolEra;
  protocolVersion: string;
}

/**
 * 校验 protocolVersion 与 protocolEra 是否为本客户端支持的合法组合：
 * - legacy：2025-06-18 或 2025-11-25（initialize 握手）；
 * - modern：2026-07-28（无 initialize、每请求自描述）。
 * 快照解析与连接信息校验共用此单一事实源。
 */
export function isSupportedMcpProtocolCombination(
  protocolVersion: unknown,
  protocolEra: unknown
): boolean {
  if (protocolEra === 'legacy') {
    return protocolVersion === '2025-06-18' || protocolVersion === '2025-11-25';
  }
  if (protocolEra === 'modern') {
    return protocolVersion === '2026-07-28';
  }
  return false;
}

/** 端点分类：远程 HTTPS、本机回环 HTTP 与私网 HTTP（局域网设备，如手机连电脑）。 */
export type McpEndpointClass = 'remote_https' | 'loopback_http' | 'private_http';

export interface ValidatedMcpEndpoint {
  normalizedUrl: string;
  endpointClass: McpEndpointClass;
}

/** 连接测试/协议协商后得到的脱敏 Server 能力信息。 */
export interface McpConnectionInfo {
  protocolVersion: string;
  protocolEra: McpProtocolEra;
  serverInfo: {
    name: string;
    version: string;
  } | null;
  capabilities: Record<string, unknown>;
}
