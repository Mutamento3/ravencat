/** 逐工具授权的查看与设置；连接成功后新发现工具默认开启，用户可按需关闭。 */

import type { McpToolGrant } from '../domain/McpToolGrant';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';
import { McpConfigError } from './McpConfigError';
import {
  parseMcpDiscoverySnapshot,
} from './McpDiscoverySnapshot';

export interface McpDiscoveredToolGrantView {
  remoteToolName: string;
  localToolName: string;
  description: string;
  schemaFingerprint: string;
  enabled: boolean;
  /** schema 变化后旧授权指纹与当前快照不一致时标记为需要重新授权。 */
  stale: boolean;
  /** 当前快照仍包含该工具时允许授权；已从快照消失的旧 grant 仅供提示。 */
  canAuthorize: boolean;
}

export async function listMcpDiscoveredToolGrants(
  serverId: string
): Promise<McpDiscoveredToolGrantView[]> {
  const runtime = getMcpToolsRuntimeDependencies();
  const server = await runtime.serverConfigRepository.getById(serverId);
  if (!server) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  const snapshot = parseMcpDiscoverySnapshot(server.toolSnapshotJson);
  const grants = await runtime.toolGrantRepository.listByServer(serverId);
  const grantByRemote = new Map(grants.map((grant) => [grant.remoteToolName, grant]));

  const snapshotTools = snapshot?.tools ?? [];
  const grantedTools = grants
    .filter((grant) => !snapshotTools.some((tool) => tool.remoteName === grant.remoteToolName))
    .map((grant) => ({
      remoteToolName: grant.remoteToolName,
      localToolName: grant.localToolName,
      description: '',
      schemaFingerprint: grant.schemaFingerprint,
      enabled: false,
      stale: true,
      canAuthorize: false,
    }));

  return [
    ...snapshotTools.map((tool) => {
      const grant = grantByRemote.get(tool.remoteName);
      return {
        remoteToolName: tool.remoteName,
        localToolName: tool.localName,
        description: tool.description,
        schemaFingerprint: tool.schemaFingerprint,
        enabled: grant?.enabled === true && grant.schemaFingerprint === tool.schemaFingerprint,
        stale: grant !== undefined && grant.schemaFingerprint !== tool.schemaFingerprint,
        canAuthorize: true,
      };
    }),
    ...grantedTools,
  ];
}

export async function setMcpToolGrant(input: {
  serverId: string;
  remoteToolName: string;
  enabled: boolean;
}): Promise<McpToolGrant> {
  const runtime = getMcpToolsRuntimeDependencies();
  const server = await runtime.serverConfigRepository.getById(input.serverId);
  if (!server) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  const snapshot = parseMcpDiscoverySnapshot(server.toolSnapshotJson);
  const tool = snapshot?.tools.find((item) => item.remoteName === input.remoteToolName);
  if (!tool) {
    throw new McpConfigError('TOOL_NOT_DISCOVERED', '该工具不在最近一次发现结果中');
  }

  return runtime.toolGrantRepository.upsert({
    serverId: input.serverId,
    remoteToolName: tool.remoteName,
    localToolName: tool.localName,
    enabled: input.enabled,
    // 用户在当前发现快照上打开开关，就是对当前 schema 的明确授权；
    // upsert 用新指纹覆盖旧 grant，完成 schema 变化后的重新授权闭环。
    schemaFingerprint: tool.schemaFingerprint,
    updatedAt: new Date().toISOString(),
  });
}
