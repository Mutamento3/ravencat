/** 保存由 Host 注入的只读提示词目录能力。 */

import type { PromptDefaultsRepository } from '../domain/PromptDefaults';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { PromptCatalogReader } from '../domain/PromptCatalogReader';
import type {
  PromptBindingRepository,
  PromptCustomBlockRepository,
  PromptPresetRepository,
  AssistantPromptConfigurationRepository,
} from '../domain/PromptingRepositories';
import type {
  PromptBindingTargetType,
  PromptCustomBlock,
} from '../domain/Prompting';
import type {
  PromptPack,
  PromptPresetDefinition,
  PromptScenarioId,
} from '@shared/prompt';

export interface SystemPromptPresetReader {
  get(scenarioId: PromptScenarioId): PromptPresetDefinition;
}

export interface PromptBindingTargetReader {
  exists(targetType: PromptBindingTargetType, targetId: string): Promise<boolean>;
  list(targetType: Exclude<PromptBindingTargetType, 'global'>): Promise<{
    id: string;
    name: string;
  }[]>;
}

export interface PromptPreviewGateway {
  preview(input: {
    scenarioId: PromptScenarioId;
    assistantId: string | null;
    groupId: string | null;
    exampleInput: string;
    useRealContext: boolean;
    preset: PromptPresetDefinition;
    customBlocks: PromptCustomBlock[];
  }): Promise<PromptPack>;
}

export interface PromptAssistantSummary {
  id: string;
  name: string;
  model: string;
  avatar: string | null;
  persona: string;
  enableTools: boolean;
  allowMultipleBubbles: boolean;
  isHostAI: boolean;
}

/** 选择编辑对象只需要身份与主理标记，不读取模型密钥或人设正文。 */
export interface PromptAssistantOption {
  id: string;
  name: string;
  isHostAI: boolean;
}

export type PromptMcpServiceConnectionStatus =
  | 'unverified'
  | 'available'
  | 'unavailable'
  | 'authentication_required';

/** 提示词中心只关心 MCP 服务级状态，不暴露远端工具目录或授权明细。 */
export interface PromptMcpServiceSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  connectionStatus: PromptMcpServiceConnectionStatus;
  enabledToolCount: number;
}

export interface PromptingRuntimeDependencies {
  defaults: PromptDefaultsRepository;
  catalog: PromptCatalogReader;
  systemPresets: SystemPromptPresetReader;
  customBlocks: PromptCustomBlockRepository;
  presets: PromptPresetRepository;
  bindings: PromptBindingRepository;
  assistantPrompts: AssistantPromptConfigurationRepository;
  assistants: {
    listOptions(): Promise<PromptAssistantOption[]>;
    list(): Promise<PromptAssistantSummary[]>;
  };
  tools: {
    list(): Promise<{
      name: string;
      description: string;
      defaultEnabled: boolean;
      mutating: boolean;
      callOnly: boolean;
      owner: string;
      hostOnly: boolean;
    }[]>;
    listOverrides(assistantId: string): Promise<{ toolName: string; enabled: boolean }[]>;
    set(assistantId: string, toolName: string, enabled: boolean): Promise<void>;
  };
  /** MCP 服务的真实全局注入状态；不得混入 assistant_tool_permissions。 */
  mcpServices: {
    list(): Promise<PromptMcpServiceSummary[]>;
    setEnabled(id: string, enabled: boolean): Promise<PromptMcpServiceSummary>;
  };
  targets: PromptBindingTargetReader;
  preview: PromptPreviewGateway;
}

const promptingRuntimeSlot = createRuntimeSlot<PromptingRuntimeDependencies>('Prompting');

export function configurePromptingRuntimeDependencies(
  dependencies: PromptingRuntimeDependencies
): void {
  promptingRuntimeSlot.configure(dependencies);
}

export function getPromptingRuntimeDependencies(): PromptingRuntimeDependencies {
  return promptingRuntimeSlot.get();
}
