/** MCP 协议无关客户端端口：连接、全量工具发现、工具调用与关闭。 */

import type {
  McpConnectionInfo,
  McpListToolsResult,
  McpToolCallResult,
} from './McpProtocolTypes';

/**
 * 通用 MCP Client Port 只暴露协议无关能力。
 * initialize、notifications/initialized、sessionId 属于具体 Adapter 内部，不得在此暴露。
 * connect 必须先于 listAllTools/callTool 完成；close 必须被 await。
 */
export interface McpClientPort {
  connect(signal: AbortSignal): Promise<McpConnectionInfo>;
  listAllTools(signal: AbortSignal): Promise<McpListToolsResult>;
  callTool(
    name: string,
    args: unknown,
    signal: AbortSignal,
    options: McpToolCallOptions
  ): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

/**
 * 本次 run 解析并冻结的工具 schema；2026 HTTP adapter 依赖它生成 Mcp-Param-*。
 * schema 的合法性与冻结所有权由上层发现快照/工具注册流程保证，Port 不复制校验。
 */
export interface McpToolCallOptions {
  readonly inputSchema: unknown;
}
