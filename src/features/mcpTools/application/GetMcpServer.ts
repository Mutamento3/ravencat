/** 读取单个 MCP Server 配置；不存在时返回 null。 */

import type { McpServerConfig } from '../domain/McpServerConfig';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';

export async function getMcpServer(id: string): Promise<McpServerConfig | null> {
  const runtime = getMcpToolsRuntimeDependencies();
  return runtime.serverConfigRepository.getById(id);
}
