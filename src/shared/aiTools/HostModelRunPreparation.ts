/** Host-owned model run enrichment；让 Feature run 共享同一轮 Prompt 与动态工具裁决。 */

import type { PromptPackBlock, PromptPackScenario } from '../prompt';

export interface HostModelRunPreparationInput {
  scenario: PromptPackScenario;
  currentAiId: string;
  isHostAI: boolean;
  persistentAllowedToolNames: readonly string[];
}

export interface HostModelRunPreparationResult {
  additionalPromptBlocks: PromptPackBlock[];
  /** 由 Host 动态管理的工具全集；调用方先从静态 allowlist 移除它们。 */
  managedToolNames: readonly string[];
  /** 本轮按产品状态可见、且仍在 persistent allowlist 中的 managed tools。 */
  dynamicAllowedToolNames: readonly string[];
}

export type PrepareHostModelRun = (
  input: HostModelRunPreparationInput,
) => Promise<HostModelRunPreparationResult>;

export function applyHostModelRunToolExposure(
  allowedToolNames: readonly string[],
  preparation: HostModelRunPreparationResult,
): string[] {
  const managed = new Set(preparation.managedToolNames);
  return [...new Set([
    ...allowedToolNames.filter((name) => !managed.has(name)),
    ...preparation.dynamicAllowedToolNames,
  ])];
}

