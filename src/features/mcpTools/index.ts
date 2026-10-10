/** MCP 配置 Feature 的唯一公共出口。 */

export type { McpServerConfig, McpServerConnectionStatus, McpServerAuthMode } from './domain/McpServerConfig';
export type { SaveMcpServerInput } from './domain/McpServerConfigRepository';
export type { McpToolGrant } from './domain/McpToolGrant';
export {
  listMcpServers,
  listMcpServersWithEnabledToolCounts,
  type McpServerListItem,
  type McpServerListItemWithEnabledToolCount,
} from './application/ListMcpServers';
export {
  getMcpServer,
} from './application/GetMcpServer';
export {
  saveMcpServer,
  type SaveMcpServerUseCaseInput,
} from './application/SaveMcpServer';
export {
  validateMcpServerEndpoint,
} from './application/McpEndpointValidator';
export type { McpEndpointClass, ValidatedMcpEndpoint } from '@platform/mcp';
export {
  deleteMcpServer,
} from './application/DeleteMcpServer';
export {
  setMcpServerEnabled,
} from './application/SetMcpServerEnabled';
export { setMcpServerAssistantEnabled } from './application/SetMcpServerAssistantEnabled';
export {
  testMcpServerConnection,
  type McpConnectionTestResult,
  type McpDiscoveredToolView,
} from './application/TestMcpServerConnection';
export {
  listMcpDiscoveredToolGrants,
  setMcpToolGrant,
  type McpDiscoveredToolGrantView,
} from './application/SetMcpToolGrant';
export {
  parseMcpDiscoverySnapshot,
  type McpDiscoverySnapshot,
} from './application/McpDiscoverySnapshot';
export {
  McpConfigError,
  type McpConfigErrorCode,
} from './application/McpConfigError';
export {
  configureMcpToolsRuntimeDependencies,
  getMcpToolsRuntimeDependencies,
  type McpToolsRuntimeDependencies,
} from './application/McpToolsRuntimeDependencies';
export {
  SQLiteMcpServerConfigRepository,
  sqliteMcpServerConfigRepository,
} from './infrastructure/SQLiteMcpServerConfigRepository';
export {
  SQLiteMcpToolGrantRepository,
  sqliteMcpToolGrantRepository,
} from './infrastructure/SQLiteMcpToolGrantRepository';
export { default as McpToolsCenterScreen } from './presentation/McpToolsCenterScreen';
export { default as McpServerConfigScreen } from './presentation/McpServerConfigScreen';
