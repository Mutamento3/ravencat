/** 注入 MCP Tools Feature 仓储与两条独立协议测试链路。 */

import {
  configureMcpToolsRuntimeDependencies,
  sqliteMcpServerConfigRepository,
  sqliteMcpToolGrantRepository,
} from '@features/mcpTools';
import { LegacyMcpClientAdapter, ModernMcpClientAdapter } from '@platform/mcp';
import { secureStoreMcpCredentialStore } from '@features/mcpTools/composition';

let configured = false;

export function configureMcpToolsRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureMcpToolsRuntimeDependencies({
    serverConfigRepository: sqliteMcpServerConfigRepository,
    toolGrantRepository: sqliteMcpToolGrantRepository,
    credentialStore: secureStoreMcpCredentialStore,
    // 测试只使用用户选择的协议；成功后的固定选择由聊天 run 从快照读取。
    createMcpClient: ({ protocolEra, ...options }) => protocolEra === 'legacy'
      ? new LegacyMcpClientAdapter(options)
      : new ModernMcpClientAdapter(options),
  });
}
