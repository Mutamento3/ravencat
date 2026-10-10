/** 将现有 Block key 映射到稳定定义、语义插槽与保护级别。 */

import type {
  PromptDefinitionProtection,
  PromptPackBlock,
  PromptPackScenario,
  PromptSlot,
} from '@shared/prompt';

interface PromptBlockMetadata {
  definitionId: string;
  slot: PromptSlot;
  protection: PromptDefinitionProtection;
}

const BLOCK_METADATA: Partial<Record<PromptPackBlock['key'], PromptBlockMetadata>> = {
  time_awareness: { definitionId: 'context.time_awareness', slot: 'dynamic_context', protection: 'overridable' },
  foundation_default_core: { definitionId: 'foundation.default_core', slot: 'foundation', protection: 'locked' },
  persona: { definitionId: 'persona.assistant', slot: 'persona', protection: 'editable' },
  visual_grounding_rules: { definitionId: 'foundation.visual_grounding', slot: 'foundation', protection: 'locked' },
  protocol_space: { definitionId: 'context.protocol_space', slot: 'user_rules', protection: 'locked' },
  tool_context_explanation: { definitionId: 'context.tool_explanation', slot: 'capabilities', protection: 'locked' },
  agent_registry_summary: { definitionId: 'context.agent_registry', slot: 'user_rules', protection: 'overridable' },
  moment_audience_candidates: { definitionId: 'context.moment_audience_candidates', slot: 'capabilities', protection: 'locked' },
  moments_social_inbox: { definitionId: 'context.moments_social_inbox', slot: 'dynamic_context', protection: 'locked' },
  group_chat_context: { definitionId: 'context.group_chat', slot: 'scenario', protection: 'locked' },
  tools_description: { definitionId: 'context.tools_description', slot: 'capabilities', protection: 'locked' },
  ledger_context_summary: { definitionId: 'scenario.ledger_reply', slot: 'scenario', protection: 'locked' },
  user_identity_summary: { definitionId: 'context.user_identity', slot: 'persona', protection: 'overridable' },
  recent_moments_summary: { definitionId: 'context.recent_moments', slot: 'dynamic_context', protection: 'overridable' },
  passive_memory: { definitionId: 'context.passive_memory', slot: 'dynamic_context', protection: 'locked' },
  conversation_summary: { definitionId: 'context.conversation_summary', slot: 'dynamic_context', protection: 'locked' },
  recent_chat_window: { definitionId: 'history.recent_chat', slot: 'history', protection: 'locked' },
  together_listening_runtime: { definitionId: 'context.together_listening_runtime', slot: 'dynamic_context', protection: 'locked' },
  current_input: { definitionId: 'input.current', slot: 'input', protection: 'locked' },
};

export function resolvePromptBlockMetadata(
  block: PromptPackBlock,
  _scenario: PromptPackScenario
): PromptBlockMetadata {
  if (block.definitionId && block.slot && block.protection) {
    return {
      definitionId: block.definitionId,
      slot: block.slot,
      protection: block.protection,
    };
  }
  const metadata = BLOCK_METADATA[block.key];
  if (!metadata) {
    throw new Error(`未登记 Prompt Block 元数据：${block.key}`);
  }
  return metadata;
}
