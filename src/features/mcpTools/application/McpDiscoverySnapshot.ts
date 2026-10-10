/** MCP 工具发现快照的严格解析与授权交集计算；损坏或非法数据不静默删减。 */

import {
  assertValidToolInputSchema,
  isSupportedMcpProtocolCombination,
  normalizeMcpServerInfo,
  type McpProtocolEra,
  type McpServerInfo,
  type StandardizedMcpTool,
} from '@platform/mcp';
import { McpConfigError } from './McpConfigError';

export interface McpDiscoverySnapshot {
  discoveredAt: string;
  serverInfo: McpServerInfo | null;
  protocolVersion: string;
  protocolEra: McpProtocolEra;
  tools: StandardizedMcpTool[];
}

/**
 * 严格解析发现快照：
 * - 空快照/明确无快照（null/undefined/'{}'）：返回 null；
 * - JSON 损坏、结构非法或任一运行字段非法：抛 DISCOVERY_SNAPSHOT_INVALID，
 *   整个快照无效，不返回静默删减后的部分工具；
 * - serverInfo 只是展示元数据，缺失或类型异常统一归一化为 null；
 * - protocolVersion / protocolEra 纳入快照语义，缺失即无效。
 */
export function parseMcpDiscoverySnapshot(
  json: string | null | undefined
): McpDiscoverySnapshot | null {
  if (!json || json === '{}') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照 JSON 损坏');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照不是 JSON 对象');
  }
  const candidate = parsed as {
    discoveredAt?: unknown;
    serverInfo?: unknown;
    protocolVersion?: unknown;
    protocolEra?: unknown;
    tools?: unknown;
  };
  if (typeof candidate.discoveredAt !== 'string' || candidate.discoveredAt.length === 0) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照缺少 discoveredAt');
  }
  if (!Array.isArray(candidate.tools)) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照缺少 tools 数组');
  }
  // 任一工具项非法即整个快照无效，不允许 filter 静默丢弃。
  const tools = candidate.tools.map((tool) => assertValidStandardizedTool(tool));
  const serverInfo = normalizeMcpServerInfo(candidate.serverInfo);
  // 版本-era 组合校验（单一事实源在 @platform/mcp）：
  // legacy ↔ 2025-06-18/2025-11-25；modern ↔ 2026-07-28。
  const protocolVersion = candidate.protocolVersion;
  const protocolEra = candidate.protocolEra;
  if (
    typeof protocolVersion !== 'string'
    || typeof protocolEra !== 'string'
    || !isSupportedMcpProtocolCombination(protocolVersion, protocolEra)
  ) {
    throw new McpConfigError(
      'DISCOVERY_SNAPSHOT_INVALID',
      `MCP 发现快照协议组合非法：${String(protocolVersion)} / ${String(protocolEra)}`
    );
  }
  // 组合校验已通过，protocolEra 必然是合法的 McpProtocolEra 字面量。
  return {
    discoveredAt: candidate.discoveredAt,
    serverInfo,
    protocolVersion,
    protocolEra: protocolEra as McpProtocolEra,
    tools,
  };
}

function assertValidStandardizedTool(value: unknown): StandardizedMcpTool {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照包含非法工具项');
  }
  const item = value as {
    remoteName?: unknown;
    localName?: unknown;
    description?: unknown;
    inputSchema?: unknown;
    schemaFingerprint?: unknown;
    annotations?: unknown;
  };
  if (typeof item.remoteName !== 'string' || item.remoteName.length === 0) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具缺少 remoteName');
  }
  if (typeof item.localName !== 'string' || item.localName.length === 0) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具缺少 localName');
  }
  if (typeof item.description !== 'string') {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具 description 非法');
  }
  try {
    assertValidToolInputSchema(item.inputSchema);
  } catch {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具 inputSchema 非法');
  }
  if (typeof item.schemaFingerprint !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(item.schemaFingerprint)) {
    throw new McpConfigError(
      'DISCOVERY_SNAPSHOT_INVALID',
      'MCP 发现快照工具 schemaFingerprint 不是 sha256 格式'
    );
  }
  if (!Object.prototype.hasOwnProperty.call(item, 'annotations')) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具缺少 annotations');
  }
  return {
    remoteName: item.remoteName,
    localName: item.localName,
    description: item.description,
    inputSchema: item.inputSchema,
    schemaFingerprint: item.schemaFingerprint,
    annotations: readAnnotations(item.annotations),
  };
}

const MCP_TOOL_ANNOTATION_KEYS = new Set([
  'title',
  'readOnlyHint',
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
]);

function readAnnotations(value: unknown): StandardizedMcpTool['annotations'] {
  if (value === null) {
    return null;
  }
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || !isPlainObject(value)
  ) {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具 annotations 非法');
  }

  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!MCP_TOOL_ANNOTATION_KEYS.has(key)) {
      throw new McpConfigError(
        'DISCOVERY_SNAPSHOT_INVALID',
        `MCP 发现快照工具 annotations 包含未知字段：${key}`
      );
    }
  }
  if ('title' in source && typeof source.title !== 'string') {
    throw new McpConfigError('DISCOVERY_SNAPSHOT_INVALID', 'MCP 发现快照工具 annotations.title 类型非法');
  }
  for (const key of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
    if (key in source && typeof source[key] !== 'boolean') {
      throw new McpConfigError(
        'DISCOVERY_SNAPSHOT_INVALID',
        `MCP 发现快照工具 annotations.${key} 类型非法`
      );
    }
  }

  return {
    ...(source.title === undefined ? {} : { title: source.title as string }),
    ...(source.readOnlyHint === undefined ? {} : { readOnlyHint: source.readOnlyHint as boolean }),
    ...(source.destructiveHint === undefined ? {} : { destructiveHint: source.destructiveHint as boolean }),
    ...(source.idempotentHint === undefined ? {} : { idempotentHint: source.idempotentHint as boolean }),
    ...(source.openWorldHint === undefined ? {} : { openWorldHint: source.openWorldHint as boolean }),
  };
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
