/** 列出全部 MCP Server 配置；不自动连接 Server，也不读取工具授权。 */

import type { McpServerConfig } from '../domain/McpServerConfig';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';

export type McpServerListItem = McpServerConfig;

/** 仅供 Server 列表 UI 展示授权数量的 DTO；运行时不要依赖这个派生字段。 */
export interface McpServerListItemWithEnabledToolCount extends McpServerConfig {
  enabledToolCount: number;
}

export async function listMcpServers(): Promise<McpServerListItem[]> {
  const runtime = getMcpToolsRuntimeDependencies();
  return runtime.serverConfigRepository.list();
}

/**
 * Server 列表的展示查询：只有明确需要显示授权数量的 UI 才调用。
 * Chat run / 权限中心只需要配置和冻结快照，不能为这个无关字段重复读取 grants。
 */
export async function listMcpServersWithEnabledToolCounts(): Promise<
  McpServerListItemWithEnabledToolCount[]
> {
  const runtime = getMcpToolsRuntimeDependencies();
  const servers = await runtime.serverConfigRepository.list();
  const grantCounts = [];
  for (const server of servers) {
    grantCounts.push(await runtime.toolGrantRepository.listEnabledByServer(server.id));
  }
  return servers.map((server, index) => ({
    ...server,
    enabledToolCount: grantCounts[index].length,
  }));
}
