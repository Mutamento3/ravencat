/** 汇总系统预设、用户配置和可绑定目标，供管理界面读取。 */

import type {
  PromptDefinitionDescriptor,
  PromptPresetDefinition,
  PromptScenarioId,
} from '@shared/prompt';
import type {
  PromptBinding,
  PromptCustomBlock,
  PromptPresetWithItems,
} from '../domain/Prompting';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

export interface PromptTargetSummary { id: string; name: string }
export interface PromptManagementWarning { id: string; message: string }

export interface PromptManagementSnapshot {
  definitions: readonly PromptDefinitionDescriptor[];
  systemPresets: PromptPresetDefinition[];
  userPresets: PromptPresetWithItems[];
  customBlocks: PromptCustomBlock[];
  bindings: PromptBinding[];
  assistants: PromptTargetSummary[];
  groups: PromptTargetSummary[];
  warnings: PromptManagementWarning[];
}

export async function getPromptManagementSnapshot(): Promise<PromptManagementSnapshot> {
  const dependencies = getPromptingRuntimeDependencies();
  const definitions = dependencies.catalog.list();
  const scenarios = [...new Set(
    definitions.flatMap((definition) => definition.supportedScenarios)
  )] as PromptScenarioId[];
  const [presets, customBlocks, assistants, groups] = await Promise.all([
    dependencies.presets.listPresets(),
    dependencies.customBlocks.listCustomBlocks(),
    dependencies.targets.list('assistant'),
    dependencies.targets.list('group'),
  ]);
  const userPresets = [];
  const bindings = [];
  for (const preset of presets) {
    userPresets.push({
      preset,
      items: await dependencies.presets.listItems(preset.id),
    });
    bindings.push(...await dependencies.bindings.listByPresetId(preset.id));
  }
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const customBlockIds = new Set(customBlocks.map((block) => block.id));
  const warnings: PromptManagementWarning[] = [];
  for (const { preset, items } of userPresets) {
    const systemPreset = dependencies.systemPresets.get(preset.scenarioId);
    if (preset.basePresetId && preset.basePresetId !== systemPreset.id) {
      warnings.push({
        id: `base:${preset.id}`,
        message: `“${preset.name}”基于旧版系统预设，建议重新复制当前默认预设后迁移自定义片段。`,
      });
    }
    for (const systemItem of systemPreset.items.filter((item) => item.protection === 'locked')) {
      if (!items.some((item) => item.definitionId === systemItem.definitionId)) {
        warnings.push({
          id: `upgrade:${preset.id}:${systemItem.definitionId}`,
          message: `“${preset.name}”缺少当前系统要求的受保护定义 ${systemItem.definitionId}，请重新复制默认预设。`,
        });
      }
    }
    for (const item of items) {
      if (item.definitionId !== 'persona.assistant'
        && !definitionIds.has(item.definitionId)
        && !customBlockIds.has(item.definitionId)) {
        warnings.push({
          id: `missing:${preset.id}:${item.id}`,
          message: `“${preset.name}”引用了已不存在的定义 ${item.definitionId}，运行时会跳过该项。`,
        });
      }
    }
  }
  return {
    definitions,
    systemPresets: scenarios.map((scenario) => dependencies.systemPresets.get(scenario)),
    userPresets,
    customBlocks,
    bindings,
    assistants,
    groups,
    warnings,
  };
}
