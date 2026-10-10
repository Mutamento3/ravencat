/** 删除 MCP Server 及其全部工具授权；调用方负责二次确认。 */

import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';
import { McpConfigError } from './McpConfigError';

export async function deleteMcpServer(id: string): Promise<void> {
  const runtime = getMcpToolsRuntimeDependencies();
  const deleted = await runtime.serverConfigRepository.delete(id);
  if (!deleted) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  if (deleted.credentialRef) await runtime.credentialStore.delete(deleted.credentialRef);
}
