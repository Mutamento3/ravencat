/** MCP Server 展示身份的统一接收语义：缺失或类型异常视为未提供。 */

import type { McpServerInfo } from './McpProtocolTypes';

/**
 * serverInfo 只用于展示、日志与诊断，不参与协议选择或工具执行。
 * 字段类型合法时保留原值（包括空字符串）；其他形状统一归一化为 null。
 */
export function normalizeMcpServerInfo(value: unknown): McpServerInfo | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { name?: unknown; version?: unknown };
  if (typeof candidate.name !== 'string' || typeof candidate.version !== 'string') {
    return null;
  }
  return { name: candidate.name, version: candidate.version };
}
