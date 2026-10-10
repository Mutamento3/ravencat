/** 校验内置目录、Provider 清单与系统预设之间的长期一致性。 */

import type { PromptScenarioId } from '@shared/prompt';
import { promptCatalog } from '../catalog';
import {
  PIPELINE_PROMPT_PROVIDER_IDS,
  REGISTERED_HOST_PROMPT_PROVIDER_IDS,
} from '../providers';
import { getSystemPromptPreset } from './systemPromptPresets';

export const PROMPT_SCENARIO_IDS: readonly PromptScenarioId[] = [
  'chat.private_reply',
  'chat.group_member_reply',
  'chat.group_admin_schedule',
  'ledger.reply',
  'call.live_reply',
  'call.outgoing_decision',
  'call.post_user_hangup',
  'together_listening.post_user_decline',
  'raven_cat.ai_schedule_trigger',
  'chat.summary',
  'vision.ocr',
];

export function validateBuiltInPromptArchitecture(): void {
  const definitions = promptCatalog.list();
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const providerIds = new Set<string>([
    ...REGISTERED_HOST_PROMPT_PROVIDER_IDS,
    ...PIPELINE_PROMPT_PROVIDER_IDS,
  ]);

  for (const definition of definitions) {
    if (definition.contentKind === 'provider' && !providerIds.has(definition.providerId || '')) {
      throw new Error(`提示词定义引用了未注册 Provider：${definition.id} -> ${definition.providerId || 'missing'}`);
    }
  }

  for (const scenarioId of PROMPT_SCENARIO_IDS) {
    const preset = getSystemPromptPreset(scenarioId);
    if (preset.items.length === 0) {
      throw new Error(`系统提示词预设没有条目：${preset.id}`);
    }
    const seenDefinitionIds = new Set<string>();
    for (const presetItem of preset.items) {
      if (seenDefinitionIds.has(presetItem.definitionId)) {
        throw new Error(`系统提示词预设重复引用定义：${preset.id} -> ${presetItem.definitionId}`);
      }
      seenDefinitionIds.add(presetItem.definitionId);
      const definition = definitionById.get(presetItem.definitionId);
      if (!definition) {
        throw new Error(`系统提示词预设引用不存在的定义：${preset.id} -> ${presetItem.definitionId}`);
      }
      if (!definition.supportedScenarios.includes(scenarioId)) {
        throw new Error(`系统提示词预设引用了不支持当前场景的定义：${preset.id} -> ${presetItem.definitionId}`);
      }
      if (definition.defaultSlot !== presetItem.slot) {
        throw new Error(`系统提示词预设使用了无效插槽：${preset.id} -> ${presetItem.definitionId}`);
      }
      if (definition.protection !== presetItem.protection) {
        throw new Error(`系统提示词预设保护级别与目录不一致：${preset.id} -> ${presetItem.definitionId}`);
      }
    }
  }
}
