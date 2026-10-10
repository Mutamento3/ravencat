/** MCP 工具发现：schema 严格校验、SHA-256 fingerprint、annotations 白名单摘要与本地名称冲突检查。 */

import { McpClientError } from './McpClientError';
import { assertAgentToolInputSchema, type JsonSchema } from '@shared/aiTools';
import type { McpToolDefinition } from './McpProtocolTypes';

export interface StandardizedMcpTool {
  remoteName: string;
  localName: string;
  description: string;
  inputSchema: unknown;
  schemaFingerprint: string;
  /** 仅保存协议白名单提示字段；不影响本地风险与确认策略。 */
  annotations: McpToolAnnotationsSummary | null;
}

/** 2025-11-25 官方 tools/list 返回的 annotations 中产品需要展示的标准提示字段。 */
export interface McpToolAnnotationsSummary {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const REMOTE_NAME_ALLOWED = /^[a-zA-Z0-9_-]+$/;

/** inputSchema 嵌套深度上限与序列化尺寸上限。 */
export const MCP_INPUT_SCHEMA_MAX_DEPTH = 20;
export const MCP_INPUT_SCHEMA_MAX_SERIALIZED_BYTES = 64 * 1024;

export function sanitizeMcpToolName(remoteName: string): string {
  if (!REMOTE_NAME_ALLOWED.test(remoteName)) {
    return remoteName.replace(/[^a-zA-Z0-9_-]+/g, '_');
  }
  return remoteName;
}

export function buildMcpLocalToolName(serverId: string, remoteName: string): string {
  const sanitized = sanitizeMcpToolName(remoteName);
  if (!sanitized) {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具名称为空');
  }
  return `mcp.${serverId}.${sanitized}`;
}

/**
 * 生成稳定的 SHA-256 fingerprint。
 * canonical serialization 使用确定性代码点排序的 key，数组保持顺序，
 * 拒绝非 JSON 值；结果固定为 sha256:<64 位小写 hex>。
 */
export function computeMcpSchemaFingerprint(inputSchema: unknown): string {
  const canonical = stableSerialize(inputSchema);
  return `sha256:${sha256Hex(canonical)}`;
}

/** 检查同一个 Server 内部清洗后 localName 是否重复；重复即协议错误。 */
export function assertNoMcpInternalNameCollision(
  standardizedTools: readonly StandardizedMcpTool[]
): void {
  const seen = new Set<string>();
  for (const tool of standardizedTools) {
    if (seen.has(tool.localName)) {
      throw new McpClientError(
        'PROTOCOL_ERROR',
        `MCP 工具清洗后本地名称冲突：${tool.localName}`
      );
    }
    seen.add(tool.localName);
  }
}

export function standardizeMcpTool(
  serverId: string,
  tool: McpToolDefinition
): StandardizedMcpTool {
  assertValidToolInputSchema(tool.inputSchema);
  return {
    remoteName: tool.name,
    localName: buildMcpLocalToolName(serverId, tool.name),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    schemaFingerprint: computeMcpSchemaFingerprint(tool.inputSchema),
    annotations: summarizeMcpToolAnnotations(tool.annotations),
  };
}

/**
 * 严格校验工具 inputSchema：
 * - 必须存在；
 * - 必须是非 null、非数组且根 type 为 object 的普通 JSON 对象；
 * - 不得包含 function/undefined/symbol/NaN/Infinity；
 * - 嵌套深度与序列化尺寸受上限约束；
 * - 非法 schema 直接抛 PROTOCOL_ERROR，不自动替换为 { type: 'object' }。
 */
export function assertValidToolInputSchema(inputSchema: unknown): void {
  if (inputSchema === undefined || inputSchema === null) {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具缺少 inputSchema');
  }
  if (typeof inputSchema !== 'object' || Array.isArray(inputSchema)) {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 必须是普通 JSON 对象');
  }
  if ((inputSchema as { type?: unknown }).type !== 'object') {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 根 type 必须为 object');
  }
  assertJsonOnlyValue(inputSchema, 0);
  const size = new TextEncoder().encode(stableSerialize(inputSchema)).byteLength;
  if (size > MCP_INPUT_SCHEMA_MAX_SERIALIZED_BYTES) {
    throw new McpClientError(
      'PROTOCOL_ERROR',
      `MCP 工具 inputSchema 序列化超限（${size} 字节 > ${MCP_INPUT_SCHEMA_MAX_SERIALIZED_BYTES}）`
    );
  }
  try {
    assertAgentToolInputSchema(inputSchema as JsonSchema);
  } catch (error) {
    throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 无法编译', error);
  }
}

/**
 * annotations 白名单摘要：只保存产品需要展示的标准提示字段。
 * 非法或非布尔字段按“忽略单字段”策略处理；不保存未知字段或原始 annotations 对象。
 */
export function summarizeMcpToolAnnotations(value: unknown): McpToolAnnotationsSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const summary: McpToolAnnotationsSummary = {};
  const readBoolean = (key: string): boolean | undefined => {
    if (typeof source[key] === 'boolean') {
      return source[key] as boolean;
    }
    return undefined;
  };
  const title = typeof source.title === 'string' ? source.title : undefined;
  const readOnlyHint = readBoolean('readOnlyHint');
  const destructiveHint = readBoolean('destructiveHint');
  const idempotentHint = readBoolean('idempotentHint');
  const openWorldHint = readBoolean('openWorldHint');
  if (title !== undefined) {
    summary.title = title;
  }
  if (readOnlyHint !== undefined) {
    summary.readOnlyHint = readOnlyHint;
  }
  if (destructiveHint !== undefined) {
    summary.destructiveHint = destructiveHint;
  }
  if (idempotentHint !== undefined) {
    summary.idempotentHint = idempotentHint;
  }
  if (openWorldHint !== undefined) {
    summary.openWorldHint = openWorldHint;
  }
  if (Object.keys(summary).length === 0) {
    return null;
  }
  return summary;
}

export function findMcpNamespaceConflict(
  standardizedTools: readonly StandardizedMcpTool[],
  existingLocalNames: ReadonlySet<string>
): StandardizedMcpTool | null {
  return standardizedTools.find((tool) => existingLocalNames.has(tool.localName)) ?? null;
}

/** 确定性 JSON 序列化：key 按代码点排序，数组保序，拒绝非 JSON 值。 */
function stableSerialize(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP schema 包含非有限数字');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new McpClientError('PROTOCOL_ERROR', 'MCP schema 包含非 JSON 值');
}

/** 确定性代码点排序，不依赖 localeCompare。 */
function compareCodePoints(left: string, right: string): number {
  const maxLength = Math.min(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const diff = left.charCodeAt(index) - right.charCodeAt(index);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

/** 递归拒绝 function/undefined/symbol/NaN/Infinity 并检查深度。 */
function assertJsonOnlyValue(value: unknown, depth: number): void {
  if (depth > MCP_INPUT_SCHEMA_MAX_DEPTH) {
    throw new McpClientError('PROTOCOL_ERROR', `MCP 工具 inputSchema 嵌套超过 ${MCP_INPUT_SCHEMA_MAX_DEPTH} 层`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 包含非有限数字');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonOnlyValue(item, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      assertJsonOnlyValue(item, depth + 1);
    }
    return;
  }
  throw new McpClientError('PROTOCOL_ERROR', 'MCP 工具 inputSchema 包含非法 JSON 值');
}

/** 纯 TS SHA-256 实现（React Native 可用，无外部依赖）。 */
function sha256Hex(value: string): string {
  const bytes = utf8Encode(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff
  );

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    const w = new Array<number>(64);
    for (let index = 0; index < 16; index += 1) {
      const offset = chunkStart + index * 4;
      w[index] = (
        (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(w[index - 15], 7) ^ rightRotate(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rightRotate(w[index - 2], 17) ^ rightRotate(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + K[index] + w[index]) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .flatMap((word) => [
      (word >>> 24) & 0xff, (word >>> 16) & 0xff, (word >>> 8) & 0xff, word & 0xff,
    ])
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function rightRotate(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Encode(value: string): number[] {
  const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  if (encoder) {
    return Array.from(encoder.encode(value));
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f)
      );
    }
  }
  return bytes;
}
