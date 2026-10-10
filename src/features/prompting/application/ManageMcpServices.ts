/** 管理提示词中心展示的全局 MCP 服务注入状态。 */

import {
  getPromptingRuntimeDependencies,
  type PromptMcpServiceSummary,
} from './PromptingRuntimeDependencies';

export type PromptCenterMcpService = PromptMcpServiceSummary;

export function getPromptCenterMcpServices(): Promise<PromptCenterMcpService[]> {
  return getPromptingRuntimeDependencies().mcpServices.list();
}

export function setPromptCenterMcpServiceEnabled(
  id: string,
  enabled: boolean,
): Promise<PromptCenterMcpService> {
  return getPromptingRuntimeDependencies().mcpServices.setEnabled(id, enabled);
}
