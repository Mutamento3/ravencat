/** 为正常 Host Agent run 装配 MCP 冻结工具并管理 run-scoped 连接池。 */

import {
  getMcpToolsRuntimeDependencies,
  listMcpServers,
} from '@features/mcpTools';
import { resolveMcpBearerToken } from '@features/mcpTools/composition';
import { NegotiatingMcpClient } from '@platform/mcp';
import type { AgentToolRegistry } from '@platform/agentRuntime';
import {
  createMcpMetaTools,
  MCP_META_TOOL_NAMES,
} from './McpAgentTool';
import { McpRunClientPool, type McpClientFactory } from './McpRunClientPool';
import {
  resolveMcpFrozenToolDefinitions,
  type McpFrozenToolDefinition,
} from './registerMcpAgentTools';

export interface McpServiceSummary {
  name: string;
  description: string;
}

/** 请求侧 policy 一次解析出的 MCP 暴露面；Prompt 与 task allowlist 共用这份结果。 */
export interface McpExposureBundle {
  allowedToolNames: string[];
  services: McpServiceSummary[];
}

const createNegotiatingMcpClient: McpClientFactory = async (url, knownProtocol, credentialRef) =>
  new NegotiatingMcpClient({ url, knownProtocol, bearerToken: await resolveMcpBearerToken(credentialRef) });

export interface HostRunMcpTools {
  /** task allowlist 中请求的全部具体 MCP 名称；Host 将这些名称从模型 task 中消费掉。 */
  allowlistMcpToolNames: string[];
  /** 本次 run 暴露给模型的固定 meta-tool；selected 为空时为空数组。 */
  metaToolNames: string[];
  dispose: () => Promise<void>;
}

/**
 * 为请求侧 policy 提供当前 MCP 工具名与服务摘要。
 * Prompt 与 task allowlist 必须消费同一份结果；run 启动时会再次冻结执行权威。
 */
export async function resolveMcpExposure(assistantId: string): Promise<McpExposureBundle> {
  const frozen = await loadMcpFrozenTools(assistantId);
  const services = new Map<string, { serverId: string; summary: McpServiceSummary }>();
  for (const tool of frozen) {
    const existing = services.get(tool.serverName);
    if (existing && existing.serverId !== tool.serverId) {
      throw new Error(`MCP 服务显示名重复且无法区分：${tool.serverName}`);
    }
    if (!existing) {
      services.set(tool.serverName, {
        serverId: tool.serverId,
        summary: {
          name: tool.serverName,
          description: tool.serverDescription,
        },
      });
    }
  }
  return {
    allowedToolNames: frozen.map((tool) => tool.localToolName),
    services: [...services.values()].map(({ summary }) => summary),
  };
}

/**
 * 将当前冻结的 MCP 工具与请求 allowlist 求交，并把固定 meta-tool 注册进唯一 Registry。
 * 仓储、快照和命名不变量错误直接暴露，不能伪装为“没有 MCP 工具”。
 */
export async function registerMcpToolsForHostRun(input: {
  assistantId: string;
  registry: AgentToolRegistry;
  allowedToolNames: readonly string[];
}): Promise<HostRunMcpTools> {
  const pool = new McpRunClientPool(createNegotiatingMcpClient);
  if (input.allowedToolNames.length === 0) {
    return emptyMcpRunTools(pool);
  }
  const registeredNames = new Set(input.registry.list().map((tool) => tool.name));
  const requestedMcpNames = input.allowedToolNames.filter((name) => (
    !registeredNames.has(name) && name.startsWith('mcp.')
  ));
  if (requestedMcpNames.length === 0) {
    return emptyMcpRunTools(pool);
  }

  const frozen = await loadMcpFrozenTools(input.assistantId);
  const requestedNameSet = new Set(requestedMcpNames);
  const selected = frozen.filter((tool) => requestedNameSet.has(tool.localToolName));
  if (selected.length === 0) {
    return {
      allowlistMcpToolNames: requestedMcpNames,
      metaToolNames: [],
      dispose: () => pool.dispose(),
    };
  }
  assertMcpServiceNamesUnambiguous(selected);

  for (const tool of createMcpMetaTools({ frozen: selected, clients: pool })) {
    input.registry.register(tool);
  }
  return {
    allowlistMcpToolNames: requestedMcpNames,
    metaToolNames: [...MCP_META_TOOL_NAMES],
    dispose: () => pool.dispose(),
  };
}

function assertMcpServiceNamesUnambiguous(
  frozen: readonly McpFrozenToolDefinition[],
): void {
  const serverIdsByName = new Map<string, string>();
  for (const tool of frozen) {
    const existingServerId = serverIdsByName.get(tool.serverName);
    if (existingServerId && existingServerId !== tool.serverId) {
      throw new Error(`MCP 服务显示名重复且无法区分：${tool.serverName}`);
    }
    serverIdsByName.set(tool.serverName, tool.serverId);
  }
}

async function loadMcpFrozenTools(assistantId: string): Promise<McpFrozenToolDefinition[]> {
  const runtime = getMcpToolsRuntimeDependencies();
  return resolveMcpFrozenToolDefinitions({
    assistantId,
    servers: await listMcpServers(),
    loadGrants: (serverId) => runtime.toolGrantRepository.listByServer(serverId),
  });
}

function emptyMcpRunTools(pool: McpRunClientPool): HostRunMcpTools {
  return {
    allowlistMcpToolNames: [],
    metaToolNames: [],
    dispose: () => pool.dispose(),
  };
}
