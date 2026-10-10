/** 启停 MCP Server；启用前置条件：已成功测试连接。 */

import type { McpServerConfig } from '../domain/McpServerConfig';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';
import { McpConfigError } from './McpConfigError';

export async function setMcpServerEnabled(
  id: string,
  enabled: boolean
): Promise<McpServerConfig> {
  const runtime = getMcpToolsRuntimeDependencies();
  const server = await runtime.serverConfigRepository.getById(id);
  if (!server) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  if (enabled) {
    if (server.connectionStatus !== 'available') {
      throw new McpConfigError('CONNECTION_NOT_VERIFIED', '启用前必须先成功测试连接');
    }
  }
  const nowIso = new Date().toISOString();
  const updated = await runtime.serverConfigRepository.updateEnabled(id, enabled, nowIso);
  if (!updated) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  return updated;
}
