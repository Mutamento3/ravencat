/** 列表快速修改服务的单个生效对象，其他对象与连接状态由 Repository 保留。 */
import type { McpServerConfig } from '../domain/McpServerConfig';
import { McpConfigError } from './McpConfigError';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';

export async function setMcpServerAssistantEnabled(
  serverId: string,
  assistantId: string,
  enabled: boolean,
): Promise<McpServerConfig> {
  const server = await getMcpToolsRuntimeDependencies().serverConfigRepository.updateAssistantEnabled(
    serverId, assistantId, enabled, new Date().toISOString(),
  );
  if (!server) throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  return server;
}
