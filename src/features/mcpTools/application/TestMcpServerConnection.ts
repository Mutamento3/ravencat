/** 测试 MCP Server 连接：connect、全量工具发现、标准化与冲突检查，并原子保存快照、状态与 grants。 */

import {
  assertNoMcpInternalNameCollision,
  findMcpNamespaceConflict,
  isMcpClientError,
  standardizeMcpTool,
  type StandardizedMcpTool,
  type McpClientPort,
  type McpProtocolEra,
} from '@platform/mcp';
import type { McpServerConfig } from '../domain/McpServerConfig';
import { getMcpToolsRuntimeDependencies } from './McpToolsRuntimeDependencies';
import { McpConfigError } from './McpConfigError';
import { validateMcpServerEndpoint } from './McpEndpointValidator';
import { resolveMcpBearerToken } from './ResolveMcpBearerToken';

/** 一次连接测试的总预算（毫秒）：覆盖所选协议连接与 tools/list 全部分页。 */
export const MCP_CONNECTION_TEST_TOTAL_BUDGET_MS = 30_000;

export interface McpDiscoveredToolView {
  remoteName: string;
  localName: string;
  description: string;
  schemaFingerprint: string;
}

export interface McpConnectionTestResult {
  server: McpServerConfig;
  serverInfo: { name: string; version: string } | null;
  tools: McpDiscoveredToolView[];
  durationMs: number;
  protocolVersion: string;
}

export async function testMcpServerConnection(
  serverId: string,
  protocolEra: McpProtocolEra
): Promise<McpConnectionTestResult> {
  const runtime = getMcpToolsRuntimeDependencies();
  const server = await runtime.serverConfigRepository.getById(serverId);
  if (!server) {
    throw new McpConfigError('SERVER_NOT_FOUND', 'MCP Server 不存在');
  }
  const endpoint = validateMcpServerEndpoint(server.url);

  const startedAt = Date.now();
  const nowIso = new Date(startedAt).toISOString();
  // 整个连接测试使用绝对 deadline，Adapter 内每个请求 timer 只取剩余时间。
  let client: McpClientPort | null = null;
  const controller = new AbortController();

  try {
    const bearerToken = await resolveMcpBearerToken(server.credentialRef);
    client = runtime.createMcpClient({
      url: server.url,
      bearerToken,
      deadlineAt: startedAt + MCP_CONNECTION_TEST_TOTAL_BUDGET_MS,
      protocolEra,
    });
    const connectionInfo = await client.connect(controller.signal);
    const discovered = await client.listAllTools(controller.signal);

    const standardized = discovered.tools.map((tool) => standardizeMcpTool(server.id, tool));
    assertNoMcpInternalNameCollision(standardized);
    const existingLocalNames = await collectOtherServerLocalNames(runtime, serverId);
    const conflict = findMcpNamespaceConflict(standardized, existingLocalNames);
    if (conflict) {
      throw new McpConfigError(
        'TOOL_NAMESPACE_CONFLICT',
        `工具 ${conflict.localName} 已由其他 MCP Server 占用`
      );
    }

    const toolViews = standardized.map(toToolView);
    const snapshot = {
      discoveredAt: nowIso,
      serverInfo: connectionInfo.serverInfo,
      protocolVersion: connectionInfo.protocolVersion,
      protocolEra: connectionInfo.protocolEra,
      // 快照保存完整标准化工具（含 inputSchema），供后续 run 冻结工具定义使用；
      // 不包含任何凭据、session ID 或服务器内部信息。
      tools: standardized,
    };
    // 连接成功的全部持久化事实必须由一个 repository 事务提交：
    // 快照、协议诊断、available/enabled 状态与本轮 grants 不能暴露中间态。
    const updated = await runtime.serverConfigRepository.commitConnectionSuccess({
      id: server.id,
      expectedUrl: server.url,
      expectedCredentialRef: server.credentialRef,
      toolSnapshotJson: JSON.stringify(snapshot),
      lastNegotiatedProtocolVersion: connectionInfo.protocolVersion,
      lastProtocolEra: connectionInfo.protocolEra,
      endpointClass: endpoint.endpointClass,
      nowIso,
      tools: standardized.map((tool) => ({
        remoteToolName: tool.remoteName,
        localToolName: tool.localName,
        schemaFingerprint: tool.schemaFingerprint,
      })),
    });
    if (!updated) {
      throw new McpConfigError('CONFIG_CHANGED', '连接测试期间配置已改变，请重新测试连接');
    }

    return {
      server: updated,
      serverInfo: connectionInfo.serverInfo,
      tools: toolViews,
      durationMs: Date.now() - startedAt,
      protocolVersion: connectionInfo.protocolVersion,
    };
  } catch (error) {
    const { connectionStatus, errorCode, message } = mapConnectionFailure(error);
    await runtime.serverConfigRepository.recordConnectionFailure({
      id: server.id,
      expectedUrl: server.url,
      expectedCredentialRef: server.credentialRef,
      connectionStatus,
      lastErrorCode: errorCode,
      nowIso,
    });
    throw new McpConfigError(errorCode, message);
  } finally {
    // close 结果不得覆盖更重要的连接测试错误；这里明确不吞错误。
    if (client !== null) await client.close();
  }
}

function toToolView(tool: StandardizedMcpTool): McpDiscoveredToolView {
  return {
    remoteName: tool.remoteName,
    localName: tool.localName,
    description: tool.description,
    schemaFingerprint: tool.schemaFingerprint,
  };
}

async function collectOtherServerLocalNames(
  runtime: ReturnType<typeof getMcpToolsRuntimeDependencies>,
  excludeServerId: string
): Promise<Set<string>> {
  const servers = await runtime.serverConfigRepository.list();
  const otherServers = servers.filter((item) => item.id !== excludeServerId);
  const grants = [];
  for (const item of otherServers) {
    grants.push(await runtime.toolGrantRepository.listByServer(item.id));
  }
  return new Set(grants.flat().map((grant) => grant.localToolName));
}

function mapConnectionFailure(error: unknown): {
  connectionStatus: 'unavailable' | 'authentication_required';
  errorCode: McpConfigError['code'];
  message: string;
} {
  if (error instanceof McpConfigError) {
    return {
      connectionStatus: 'unavailable',
      errorCode: error.code,
      message: error.message,
    };
  }
  if (isMcpClientError(error)) {
    if (error.code === 'AUTH_REQUIRED') {
      return {
        connectionStatus: 'authentication_required',
        errorCode: 'CONNECTION_FAILED',
        message: error.message,
      };
    }
    if (error.code === 'PROTOCOL_VERSION_UNSUPPORTED') {
      return {
        connectionStatus: 'unavailable',
        errorCode: 'PROTOCOL_VERSION_UNSUPPORTED',
        message: error.message,
      };
    }
    if (error.code === 'PROTOCOL_ERROR' || error.code === 'PAYLOAD_TOO_LARGE') {
      return {
        connectionStatus: 'unavailable',
        errorCode: 'TOOL_DISCOVERY_FAILED',
        message: error.message,
      };
    }
    return {
      connectionStatus: 'unavailable',
      errorCode: 'CONNECTION_FAILED',
      message: error.message,
    };
  }
  return {
    connectionStatus: 'unavailable',
    errorCode: 'CONNECTION_FAILED',
    message: error instanceof Error ? error.message : 'MCP 连接测试失败',
  };
}
