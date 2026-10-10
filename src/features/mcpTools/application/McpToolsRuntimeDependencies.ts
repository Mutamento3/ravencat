/** MCP Tools 应用层依赖端口，隔离仓储与 MCP client 传输。 */

import type { McpClientPort, McpProtocolEra } from '@platform/mcp';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { McpServerConfigRepository } from '../domain/McpServerConfigRepository';
import type { McpToolGrantRepository } from '../domain/McpToolGrantRepository';
import type { McpCredentialStore } from '../domain/McpCredentialStore';

export interface McpToolsRuntimeDependencies {
  serverConfigRepository: McpServerConfigRepository;
  toolGrantRepository: McpToolGrantRepository;
  credentialStore: McpCredentialStore;
  createMcpClient(input: { url: string; bearerToken?: string; deadlineAt?: number; protocolEra: McpProtocolEra }): McpClientPort;
}

const mcpToolsRuntimeSlot = createRuntimeSlot<McpToolsRuntimeDependencies>('MCP Tools');

export function configureMcpToolsRuntimeDependencies(
  dependencies: McpToolsRuntimeDependencies
): void {
  mcpToolsRuntimeSlot.configure(dependencies);
}

export function getMcpToolsRuntimeDependencies(): McpToolsRuntimeDependencies {
  return mcpToolsRuntimeSlot.get();
}
