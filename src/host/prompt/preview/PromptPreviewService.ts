/** 为提示词中心生成安全摘要或用户显式授权的真实上下文 Prompt Pack。 */

import { aiAssistantRepository, type AIProfile } from '@features/assistants';
import {
  groupChatRepository,
  messageRepository,
  sessionRepository,
} from '@features/chat/composition';
import { momentRepository } from '@features/moments';
import { protocolRepository } from '@features/protocol';
import { userProfileRepository } from '@features/profile';
import {
  resolveAssistantPromptConfiguration,
  type PromptPreviewGateway,
} from '@features/prompting';
import { ledgerRepository } from '@features/wallet';
import { buildCallLivePromptBlocks } from '@features/calls';
import { DEFAULT_SELF_NAME } from '@shared';
import { ToolContext } from '@shared/aiTools';
import type { PromptPackBlock, PromptPresetItemDefinition, PromptScenarioId } from '@shared/prompt';
import { promptCatalog } from '../catalog';
import { promptPackCompiler } from '../compiler';
import { promptPackAssembler } from '../PromptPackAssembler';
import { resolveBuiltInPromptContent } from '../PromptBuiltInContent';

const PACK_SCENARIOS = new Set([
  'chat.private_reply', 'chat.group_member_reply', 'ledger.reply',
  'call.live_reply',
]);

export const promptPreviewService: PromptPreviewGateway = {
  async preview(input) {
    const assistant = await resolveAssistant(input.assistantId);
    if (!input.useRealContext) {
      return buildSafePreview(
        input,
        assistant,
        await resolveEffectivePromptConfig(assistant, input.scenarioId)
      );
    }
    if (!PACK_SCENARIOS.has(input.scenarioId)) {
      throw new Error('当前内部任务只支持安全预览，不读取真实上下文');
    }
    if (!assistant) throw new Error('真实上下文预览需要选择 AI');
    const effectivePromptConfig = await resolveEffectivePromptConfig(assistant, input.scenarioId);
    const group = input.groupId ? await groupChatRepository.getById(input.groupId) : null;
    const session = input.scenarioId === 'chat.group_member_reply'
      ? null
      : await sessionRepository.getCanonicalConversation(assistant.id);
    const sessionId = group?.group.id || session?.id || `prompt-preview:${assistant.id}`;
    const triggerSource = getTriggerSource(input.scenarioId);
    const runtimeContext = {
      triggerSource,
      triggerReason: 'prompt_center_preview',
      memoryParticipation: 'read_only' as const,
      recentWindowLimit: 10,
      ...(group ? {
        groupChat: {
          groupId: group.group.id,
          groupName: group.group.name,
          currentAIId: assistant.id,
          currentAgentId: assistant.agentId,
          currentAIName: assistant.name,
          members: group.members.filter(member => member.enabled).map((member) => ({
            muted: member.muted,
            aiAssistantId: member.aiAssistantId,
            agentId: member.agentId,
            name: member.name || member.agentId,
          })),
          recentWindowLimit: 10,
        },
      } : {}),
    };
    const toolContext = new ToolContext({
      aiConfig: assistant,
      sessionId,
      triggerSource,
      triggerReason: 'prompt_center_preview',
      capabilities: [],
      repositories: {
        message: messageRepository,
        protocol: protocolRepository,
        moment: momentRepository,
        profile: userProfileRepository,
        ledger: ledgerRepository,
      },
    });
    const params = {
      sessionId,
      currentInput: input.exampleInput,
      aiConfig: {
        ...toPromptAIConfig(assistant),
        promptDefinitionOverrides: effectivePromptConfig.overrides,
        messageTimestampsEnabled: effectivePromptConfig.messageTimestampsEnabled,
      },
      toolContext,
      runtimeContext,
      preset: input.preset,
      additionalBlocks: [
        ...buildScenarioBlocks(input.scenarioId),
        ...buildCustomBlocks(input.customBlocks),
      ],
    };
    if (input.scenarioId === 'ledger.reply') {
      return promptPackAssembler.assembleLedgerPromptPack(params);
    }
    return promptPackAssembler.assembleChatPromptPack(params);
  },
};

async function resolveAssistant(assistantId: string | null): Promise<AIProfile | null> {
  if (assistantId) return aiAssistantRepository.getById(assistantId);
  return (await aiAssistantRepository.getAll())[0] || null;
}

function buildScenarioBlocks(scenarioId: string): PromptPackBlock[] {
  if (scenarioId === 'call.live_reply') return buildCallLivePromptBlocks();
  return [];
}

/**
 * 解析预览要展示的静态配置：用户对该 AI 的覆盖正文。
 *
 * 走的正是运行时组装用的同一个解析函数，因此预览与运行时不会各有一套覆盖规则。
 * 这里只读该 AI 的提示词配置，不读聊天、记忆、协议、动态或账本等正文。
 */
async function resolveEffectivePromptConfig(
  assistant: AIProfile | null,
  scenarioId: PromptScenarioId
): Promise<{ overrides: Record<string, string>; messageTimestampsEnabled: boolean }> {
  if (!assistant) {
    return { overrides: {}, messageTimestampsEnabled: false };
  }
  const configuration = await resolveAssistantPromptConfiguration({
    assistantId: assistant.id,
    scenarioId,
    toolsEnabled: assistant.enableTools === true,
  });
  return { overrides: configuration.overrides, messageTimestampsEnabled: configuration.messageTimestampsEnabled };
}

function buildSafePreview(
  input: Parameters<PromptPreviewGateway['preview']>[0],
  assistant: AIProfile | null,
  effective: { overrides: Record<string, string>; messageTimestampsEnabled: boolean }
) {
  const customById = new Map(input.customBlocks.map((block) => [block.id, block]));
  // 安全预览不读用户资料，用户显示名回落默认称呼；其余占位符按运行时同一规则展开。
  const userDisplayName = DEFAULT_SELF_NAME;
  const blocks = input.preset.items.filter((item) => item.enabled).map((item) => {
    const custom = customById.get(item.definitionId);
    const descriptor = promptCatalog.getById(item.definitionId);
    const isInput = item.definitionId === 'input.current';
    const isHistory = item.definitionId === 'history.recent_chat';
    const isPersona = item.definitionId === 'persona.assistant';
    // 静态正文（内置默认、用户覆盖或自定义块）不是敏感运行时数据：安全预览必须展示
    // 模型真正会收到的正文，否则"最终 Prompt Pack 检查器"只会显示一句摘要。
    // 只有 provider 型动态块才回落到摘要，且不因此去读取真实数据。
    const staticContent = custom?.content
      ?? effective.overrides[item.definitionId]
      ?? descriptor?.defaultContent
      ?? descriptor?.content;
    const content = isInput
      ? input.exampleInput
      : isHistory
        ? ''
        : isPersona
          ? assistant?.systemPrompt?.trim() || '[未设置 AI 人设]'
          : staticContent
            ? resolveBuiltInPromptContent({
                content: staticContent,
                userDisplayName,
                modelName: assistant?.model,
              })
            : `[安全预览摘要] ${descriptor?.contentDescription || item.definitionId}`;
    return {
      key: getPreviewKey(item),
      instanceId: `preview:${item.definitionId}`,
      definitionId: item.definitionId,
      slot: item.slot,
      protection: item.protection,
      title: custom?.name || descriptor?.name || item.definitionId,
      content,
      required: item.required,
      status: content ? 'ready' as const : 'omitted' as const,
      source: descriptor?.contentKind === 'provider' ? 'preview:provider_not_loaded' : 'preview:safe',
      truncatable: item.protection !== 'locked',
      scenario: input.scenarioId,
      placement: isInput ? 'input' as const : isHistory ? 'history' as const : 'system' as const,
    } satisfies PromptPackBlock;
  });
  return promptPackCompiler.compile({
    scenario: input.scenarioId,
    blocks,
    recentMessages: [],
    currentInput: { role: 'user', content: input.exampleInput },
    messageTimestampsEnabled: effective.messageTimestampsEnabled,
    preset: input.preset,
  });
}

function buildCustomBlocks(
  customBlocks: Parameters<PromptPreviewGateway['preview']>[0]['customBlocks']
): PromptPackBlock[] {
  return customBlocks.map((block) => ({
    key: 'persona',
    instanceId: `custom:${block.id}`,
    definitionId: block.id,
    slot: block.defaultSlot,
    protection: 'editable',
    title: block.name,
    content: block.content,
    required: false,
    status: 'ready',
    source: 'prompt_custom_blocks',
    truncatable: true,
    scenario: 'shared',
    placement: 'system',
  }));
}

function getPreviewKey(item: PromptPresetItemDefinition): PromptPackBlock['key'] {
  if (item.definitionId === 'input.current') return 'current_input';
  if (item.definitionId === 'history.recent_chat') return 'recent_chat_window';
  if (item.definitionId === 'foundation.default_core') return 'foundation_default_core';
  if (item.definitionId === 'foundation.visual_grounding') return 'visual_grounding_rules';
  return 'persona';
}

function getTriggerSource(scenarioId: string): string {
  if (scenarioId === 'ledger.reply') return 'ledger';
  if (scenarioId === 'call.live_reply') return 'call';
  if (scenarioId === 'chat.group_member_reply') return 'group_chat';
  return 'user_message';
}

function toPromptAIConfig(assistant: AIProfile) {
  return {
    id: assistant.id,
    agentId: assistant.agentId,
    name: assistant.name,
    model: assistant.model,
    systemPrompt: assistant.systemPrompt || undefined,
    enableTools: assistant.enableTools,
    allowMultipleBubbles: assistant.allowMultipleBubbles,
    isHostAI: assistant.isHostAI,
    isBlocked: assistant.isBlocked,
  };
}
