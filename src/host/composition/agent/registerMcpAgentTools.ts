/** 把已启用、可用且获授权的 MCP 工具解析为本次 run 的冻结执行定义；不执行业务。 */

import type { JsonSchema } from '@shared/aiTools';
import type { McpProtocolEra } from '@platform/mcp';
import {
  parseMcpDiscoverySnapshot,
  type McpServerListItem,
  type McpToolGrant,
} from '@features/mcpTools';

export interface McpFrozenToolDefinition {
  serverId: string;
  serverName: string;
  /** 用户为 MCP 服务填写的短简介，供模型先了解服务用途。 */
  serverDescription: string;
  serverUrl: string;
  credentialRef: string | null;
  /** 最近成功测试得到的固定协议选择；Chat run 只信任它，不在执行中跨 era。 */
  protocolEra: McpProtocolEra;
  protocolVersion: string;
  remoteToolName: string;
  localToolName: string;
  description: string;
  inputSchema: JsonSchema;
  schemaFingerprint: string;
}

export interface ResolveMcpFrozenToolsInput {
  assistantId: string;
  /** 已启用且连接可用的 Server；快照按当前配置即时读取。 */
  servers: McpServerListItem[];
  loadGrants(serverId: string): Promise<McpToolGrant[]>;
}

/**
 * 生成本次 run 的冻结工具快照：
 * - 只接受“已启用且 available”的 Server；
 * - 工具必须同时出现在最近发现快照、已获授权且 schema 指纹一致；
 * - 从远端消失或 schema 变化的工具不会进入快照；
 * - MCP grant 只决定工具是否进入当前 run 的 allowlist，不推导通用确认或前台行为。
 */
export async function resolveMcpFrozenToolDefinitions(
  input: ResolveMcpFrozenToolsInput
): Promise<McpFrozenToolDefinition[]> {
  const frozen: McpFrozenToolDefinition[] = [];
  for (const server of input.servers) {
    if (!server.enabled || server.connectionStatus !== 'available' || !server.assistantIds.includes(input.assistantId)) {
      continue;
    }
    const snapshot = parseMcpDiscoverySnapshot(server.toolSnapshotJson);
    if (!snapshot) {
      continue;
    }
    const grants = await input.loadGrants(server.id);
    const grantByRemote = new Map(grants.map((grant) => [grant.remoteToolName, grant]));
    for (const tool of snapshot.tools) {
      const grant = grantByRemote.get(tool.remoteName);
      if (!grant || !grant.enabled || grant.schemaFingerprint !== tool.schemaFingerprint) {
        continue;
      }
      frozen.push({
        serverId: server.id,
        serverName: server.name,
        serverDescription: server.description,
        serverUrl: server.url,
        credentialRef: server.credentialRef,
        protocolEra: snapshot.protocolEra,
        protocolVersion: snapshot.protocolVersion,
        remoteToolName: tool.remoteName,
        localToolName: tool.localName,
        description: tool.description,
        inputSchema: tool.inputSchema as JsonSchema,
        schemaFingerprint: tool.schemaFingerprint,
      });
    }
  }
  return frozen;
}
