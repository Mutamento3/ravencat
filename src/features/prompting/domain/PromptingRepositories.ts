/** 定义提示词用户配置持久化端口。 */

import type {
  PromptBinding,
  PromptBindingTargetType,
  PromptCustomBlock,
  PromptPreset,
  PromptPresetItem,
  AssistantPromptSettings,
  AssistantPromptDefinitionState,
  AssistantPromptDefinitionOverride,
  AssistantUserPrompt,
  PromptMigrationOrphan,
  PromptLanguageMode,
} from './Prompting';
import type { PromptScenarioId } from '@shared/prompt';

export interface PromptCustomBlockRepository {
  listCustomBlocks(): Promise<PromptCustomBlock[]>;
  getCustomBlockById(id: string): Promise<PromptCustomBlock | null>;
  saveCustomBlock(block: PromptCustomBlock): Promise<PromptCustomBlock>;
  deleteCustomBlock(id: string): Promise<boolean>;
}

export interface PromptPresetRepository {
  listPresets(scenarioId?: PromptScenarioId): Promise<PromptPreset[]>;
  getPresetById(id: string): Promise<PromptPreset | null>;
  savePreset(preset: PromptPreset): Promise<PromptPreset>;
  listItems(presetId: string): Promise<PromptPresetItem[]>;
  listItemsByDefinitionId(definitionId: string): Promise<PromptPresetItem[]>;
  replaceItems(presetId: string, items: PromptPresetItem[]): Promise<PromptPresetItem[]>;
  deletePreset(id: string): Promise<boolean>;
}

export interface PromptBindingRepository {
  listByPresetId(presetId: string): Promise<PromptBinding[]>;
  find(
    scenarioId: PromptScenarioId,
    targetType: PromptBindingTargetType,
    targetId: string | null
  ): Promise<PromptBinding | null>;
  saveBinding(binding: PromptBinding): Promise<PromptBinding>;
  deleteBinding(id: string): Promise<boolean>;
}

export interface AssistantPromptConfigurationRepository {
  listDirectToolNames(assistantId: string): Promise<string[]>;
  setDirectToolExposure(assistantId: string, toolName: string, exposed: boolean): Promise<void>;
  /** 原子替换指定 AI 在工具范围内的星标，范围之外的偏好保持不变。 */
  applyDirectToolSnapshot(assistantIds: readonly string[], toolNames: readonly string[], exposedToolNames: readonly string[]): Promise<void>;
  getAssistantSettings(assistantId: string): Promise<AssistantPromptSettings | null>;
  saveAssistantLanguageMode(assistantId: string, languageMode: PromptLanguageMode): Promise<AssistantPromptSettings>;
  listDefinitionStates(assistantId: string): Promise<AssistantPromptDefinitionState[]>;
  saveDefinitionState(state: AssistantPromptDefinitionState): Promise<AssistantPromptDefinitionState>;
  listDefinitionOverrides(assistantId: string): Promise<AssistantPromptDefinitionOverride[]>;
  saveDefinitionOverride(override: AssistantPromptDefinitionOverride): Promise<AssistantPromptDefinitionOverride>;
  resetDefinitionOverride(assistantId: string, definitionId: string, locale: 'zh-CN' | 'en-US'): Promise<boolean>;
  listAssistantUserPrompts(assistantId: string): Promise<AssistantUserPrompt[]>;
  saveAssistantUserPrompt(prompt: AssistantUserPrompt): Promise<AssistantUserPrompt>;
  saveAssistantUserPrompts(prompts: AssistantUserPrompt[]): Promise<AssistantUserPrompt[]>;
  deleteAssistantUserPrompt(id: string, assistantId: string): Promise<boolean>;
  listMigrationOrphans(): Promise<PromptMigrationOrphan[]>;
}
