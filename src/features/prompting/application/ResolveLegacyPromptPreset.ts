/** 只读解析 2.x 预设与绑定，保证升级后历史配置仍可运行；3.0 删除。 */

import type {
  PromptDefinitionProtection,
  PromptPresetDefinition,
  PromptScenarioId,
} from '@shared/prompt';
import type {
  PromptBinding,
  PromptBindingTargetType,
  PromptPreset,
} from '../domain/Prompting';
import { getPromptingRuntimeDependencies } from './PromptingRuntimeDependencies';

const INTERNAL_PROMPT_SCENARIOS = new Set<PromptScenarioId>([
  'chat.summary', 'vision.ocr',
]);

export interface ResolvedPromptPreset {
  preset: PromptPresetDefinition;
  source: 'group' | 'assistant' | 'global' | 'system_default';
  binding: PromptBinding | null;
  storedPreset: PromptPreset | null;
}

export async function resolveLegacyPromptPreset(input: {
  scenarioId: PromptScenarioId;
  assistantId?: string | null;
  groupId?: string | null;
}): Promise<ResolvedPromptPreset> {
  const dependencies = getPromptingRuntimeDependencies();
  if (INTERNAL_PROMPT_SCENARIOS.has(input.scenarioId)) {
    return systemDefault(dependencies.systemPresets.get(input.scenarioId));
  }

  const candidates: {
    source: ResolvedPromptPreset['source'];
    targetType: PromptBindingTargetType;
    targetId: string | null;
  }[] = [];
  if (input.groupId) candidates.push({ source: 'group', targetType: 'group', targetId: input.groupId });
  if (input.assistantId) candidates.push({ source: 'assistant', targetType: 'assistant', targetId: input.assistantId });
  candidates.push({ source: 'global', targetType: 'global', targetId: null });

  for (const candidate of candidates) {
    const binding = await dependencies.bindings.find(
      input.scenarioId, candidate.targetType, candidate.targetId
    );
    if (!binding) continue;
    const storedPreset = await dependencies.presets.getPresetById(binding.presetId);
    if (!storedPreset || storedPreset.scenarioId !== input.scenarioId) continue;
    const items = await dependencies.presets.listItems(storedPreset.id);
    const systemItems = dependencies.systemPresets.get(input.scenarioId).items;
    const presetItems = [];
    for (const item of items) {
      const descriptor = dependencies.catalog.getById(item.definitionId);
      const custom = descriptor || item.definitionId === 'persona.assistant'
        ? null
        : await dependencies.customBlocks.getCustomBlockById(item.definitionId);
      if (!descriptor && item.definitionId !== 'persona.assistant' && !custom) continue;
      const protection: PromptDefinitionProtection = descriptor?.protection || 'editable';
      const systemItem = systemItems.find((candidateItem) => (
        candidateItem.definitionId === item.definitionId
      ));
      presetItems.push({
        definitionId: item.definitionId,
        slot: item.slot,
        sortOrder: item.sortOrder,
        enabled: item.enabled,
        required: systemItem?.required || false,
        protection: systemItem?.protection || protection,
      });
    }
    return {
      preset: {
        id: storedPreset.id,
        version: 1,
        name: storedPreset.name,
        scenarioId: storedPreset.scenarioId,
        tokenBudget: storedPreset.tokenBudget || undefined,
        items: presetItems,
      },
      source: candidate.source,
      binding,
      storedPreset,
    };
  }
  return systemDefault(dependencies.systemPresets.get(input.scenarioId));
}

function systemDefault(preset: PromptPresetDefinition): ResolvedPromptPreset {
  return { preset, source: 'system_default', binding: null, storedPreset: null };
}
