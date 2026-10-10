/** MCP 协议无关 client port、Legacy / Modern Adapter 与 era 协商客户端的 platform 公共出口。 */

export type { McpClientPort, McpToolCallOptions } from './McpClientPort';
export { isMcpClientError, McpClientError } from './McpClientError';
export type { McpClientErrorCode } from './McpClientError';
export { normalizeMcpServerInfo } from './McpServerInfo';
export {
  MCP_PROTOCOL_VERSION_2025_11_25,
  MCP_TOOLS_LIST_DEFAULTS,
  LegacyMcpClientAdapter,
} from './legacy/LegacyMcpClientAdapter';
export type { LegacyMcpClientAdapterOptions } from './legacy/LegacyMcpClientAdapter';
export {
  MCP_PROTOCOL_VERSION_2026_07_28,
  ModernMcpClientAdapter,
} from './modern/ModernMcpClientAdapter';
export type { ModernMcpClientAdapterOptions } from './modern/ModernMcpClientAdapter';
export { NegotiatingMcpClient } from './NegotiatingMcpClient';
export type { NegotiatingMcpClientOptions } from './NegotiatingMcpClient';
export type {
  McpConnectionInfo,
  McpEndpointClass,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpListToolsResult,
  McpProtocolEra,
  McpProtocolSelection,
  McpServerInfo,
  McpToolCallContentPart,
  McpToolCallResult,
  McpToolDefinition,
  ValidatedMcpEndpoint,
} from './McpProtocolTypes';
export { isSupportedMcpProtocolCombination } from './McpProtocolTypes';
export {
  classifyMcpProbeOutcome,
  classifyProbeOutcome,
  MCP_MODERN_PROTOCOL_VERSIONS,
} from './ProbeClassifier';
export type { ProbeClassifierContext, ProbeOutcome, ProbeVerdict } from './ProbeClassifier';
export {
  assertNoMcpInternalNameCollision,
  assertValidToolInputSchema,
  buildMcpLocalToolName,
  computeMcpSchemaFingerprint,
  findMcpNamespaceConflict,
  MCP_INPUT_SCHEMA_MAX_DEPTH,
  MCP_INPUT_SCHEMA_MAX_SERIALIZED_BYTES,
  sanitizeMcpToolName,
  standardizeMcpTool,
  summarizeMcpToolAnnotations,
} from './McpToolStandardization';
export type { McpToolAnnotationsSummary, StandardizedMcpTool } from './McpToolStandardization';
