/** 用代码内置预设复现迁移前的固定 Prompt Block 顺序。 */

import type {
  PromptDefinitionProtection,
  PromptPackScenario,
  PromptPresetDefinition,
  PromptPresetItemDefinition,
  PromptSlot,
} from '@shared/prompt';

const PRESET_NAMES: Record<PromptPackScenario, string> = {
  'chat.private_reply': '默认私聊回复',
  'chat.group_member_reply': '默认群聊成员回复',
  'chat.group_admin_schedule': '默认群聊管理员',
  'ledger.reply': '默认账本回复',
  'call.live_reply': '默认通话中回复',
  'call.outgoing_decision': '默认去电决策',
  'call.post_user_hangup': '默认用户挂断后跟进决策',
  'together_listening.post_user_decline': '默认一起听邀请被拒后跟进决策',
  'raven_cat.ai_schedule_trigger': '默认 AI 日程触发',
  'chat.summary': '默认聊天摘要',
  'vision.ocr': '默认 OCR',
};

function item(
  definitionId: string,
  slot: PromptSlot,
  sortOrder: number,
  protection: PromptDefinitionProtection = 'overridable',
  required = false
): PromptPresetItemDefinition {
  return { definitionId, slot, sortOrder, enabled: true, required, protection };
}

const FOUNDATION_ITEMS: PromptPresetItemDefinition[] = [
  item('foundation.default_core', 'foundation', 20, 'locked'),
  item('persona.assistant', 'persona', 30, 'editable'),
];

const CORE_ITEMS: PromptPresetItemDefinition[] = [
  item('context.time_awareness', 'dynamic_context', 10, 'overridable'),
  ...FOUNDATION_ITEMS,
];

const SHARED_CONTEXT_ITEMS: PromptPresetItemDefinition[] = [
  item('context.protocol_space', 'user_rules', 60, 'locked'),
  item('context.agent_registry', 'user_rules', 80),
  item('context.user_identity', 'persona', 35),
];

const GROUP_CONTEXT_ITEMS: PromptPresetItemDefinition[] = [
  item('context.agent_registry', 'user_rules', 80),
  item('context.protocol_space', 'user_rules', 60, 'locked'),
  item('context.user_identity', 'persona', 35),
];

const TOOL_CONTEXT_ITEMS: PromptPresetItemDefinition[] = [
  item('context.tool_explanation', 'capabilities', 70, 'locked'),
  item('context.tools_description', 'capabilities', 100, 'locked'),
  item('context.mcp_services', 'capabilities', 110, 'locked'),
];

const PRIVATE_MEMORY_ITEMS: PromptPresetItemDefinition[] = [
  item('context.conversation_summary', 'dynamic_context', 160, 'locked'),
  item('context.passive_memory', 'dynamic_context', 180, 'locked'),
];

const TOGETHER_LISTENING_RUNTIME_ITEM = item(
  'context.together_listening_runtime',
  'dynamic_context',
  120,
  'locked',
);

const HISTORY_AND_INPUT_ITEMS: PromptPresetItemDefinition[] = [
  item('history.recent_chat', 'history', 190, 'locked'),
  item('input.current', 'input', 200, 'locked', true),
];

const SPECIALIZED_PRESET_ITEMS: Partial<Record<PromptPackScenario, PromptPresetItemDefinition[]>> = {
  'chat.group_admin_schedule': [
    item('scenario.group_admin_schedule', 'scenario', 10, 'overridable', true),
    item('output.group_admin_speaker_array', 'output_contract', 20, 'locked', true),
    item('input.current', 'input', 30, 'locked', true),
  ],
  'call.post_user_hangup': [
    item('persona.assistant', 'persona', 10, 'editable'),
    item('scenario.call_post_user_hangup', 'scenario', 20, 'locked', true),
    item('output.call_post_user_hangup_json', 'output_contract', 30, 'locked', true),
    item('input.current', 'input', 40, 'locked', true),
  ],
  'together_listening.post_user_decline': [
    item('persona.assistant', 'persona', 10, 'editable'),
    item('scenario.together_listening_post_user_decline', 'scenario', 20, 'locked', true),
    item('output.together_listening_post_user_decline_json', 'output_contract', 30, 'locked', true),
    item('input.current', 'input', 40, 'locked', true),
  ],
  'chat.summary': [
    item('foundation.default_core', 'foundation', 20, 'locked'),
    item('persona.assistant', 'persona', 30, 'editable'),
    item('context.user_identity', 'persona', 35),
    item('context.protocol_space', 'user_rules', 60, 'locked'),
    item('context.tools_description', 'capabilities', 100, 'locked'),
    item('internal.chat_summary', 'output_contract', 210, 'locked', true),
    item('input.current', 'input', 220, 'locked', true),
  ],
  'vision.ocr': [
    item('internal.vision_ocr', 'foundation', 10, 'overridable', true),
    item('output.vision_ocr_plain_text', 'output_contract', 20, 'locked', true),
    item('input.current', 'input', 30, 'locked', true),
  ],
  'raven_cat.ai_schedule_trigger': [
    ...FOUNDATION_ITEMS,
    ...SHARED_CONTEXT_ITEMS,
    ...TOOL_CONTEXT_ITEMS,
    TOGETHER_LISTENING_RUNTIME_ITEM,
    item('scenario.raven_cat_ai_schedule', 'output_contract', 210, 'locked', true),
    item('context.raven_cat_ai_schedule', 'dynamic_context', 136, 'locked', true),
  ],
};

const SCENARIO_EXTENSION_ITEMS: Partial<Record<PromptPackScenario, PromptPresetItemDefinition[]>> = {
  'call.live_reply': [
    item('scenario.call_live_speech', 'scenario', 115, 'locked', true),
    item('capability.call_visual_snapshot', 'capabilities', 116, 'locked', true),
    item('output.call_plain_spoken_text', 'output_contract', 125, 'locked', true),
    item('control.call_end_marker', 'output_contract', 126, 'locked', true),
  ],
};

const PROMPT_PACK_ITEMS: Partial<Record<PromptPackScenario, PromptPresetItemDefinition[]>> = {
  'chat.private_reply': [
    ...CORE_ITEMS,
    ...SHARED_CONTEXT_ITEMS,
    ...TOOL_CONTEXT_ITEMS,
    TOGETHER_LISTENING_RUNTIME_ITEM,
    item('context.moments_social_inbox', 'dynamic_context', 125, 'locked'),
    ...PRIVATE_MEMORY_ITEMS,
    ...HISTORY_AND_INPUT_ITEMS,
  ],
  'chat.group_member_reply': [
    ...CORE_ITEMS,
    ...GROUP_CONTEXT_ITEMS,
    ...TOOL_CONTEXT_ITEMS,
    item('context.moments_social_inbox', 'dynamic_context', 125, 'locked'),
    item('context.group_chat', 'persona', 38, 'locked'),
    item('output.group_member_reply_confidentiality', 'output_contract', 95, 'locked', true),
    ...HISTORY_AND_INPUT_ITEMS,
  ],
  'ledger.reply': [
    ...CORE_ITEMS,
    ...SHARED_CONTEXT_ITEMS,
    ...TOOL_CONTEXT_ITEMS,
    item('scenario.ledger_reply', 'output_contract', 210, 'locked'),

    ...HISTORY_AND_INPUT_ITEMS,
  ],
  'call.live_reply': [
    ...CORE_ITEMS,
    ...SHARED_CONTEXT_ITEMS,
    item('context.tool_explanation', 'capabilities', 70, 'locked'),
    ...(SCENARIO_EXTENSION_ITEMS['call.live_reply'] || []),
    ...PRIVATE_MEMORY_ITEMS,
    ...HISTORY_AND_INPUT_ITEMS,
  ],
  'call.outgoing_decision': [
    ...CORE_ITEMS,
    ...SHARED_CONTEXT_ITEMS,
    item('scenario.call_outgoing_decision', 'scenario', 110, 'locked', true),
    item('output.call_outgoing_decision_json', 'output_contract', 120, 'locked', true),
    ...PRIVATE_MEMORY_ITEMS,
    ...HISTORY_AND_INPUT_ITEMS,
  ],
};

export function getSystemPromptPreset(scenario: PromptPackScenario): PromptPresetDefinition {
  const specializedItems = SPECIALIZED_PRESET_ITEMS[scenario];
  return {
    id: `system.${scenario}`,
    version: 1,
    name: PRESET_NAMES[scenario],
    scenarioId: scenario,
    items: (specializedItems || PROMPT_PACK_ITEMS[scenario] || [])
      .map((presetItem) => ({ ...presetItem })),
  };
}
