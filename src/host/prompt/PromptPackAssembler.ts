/** 组合跨 Feature 上下文并生成各 AI 场景使用的 Prompt Pack。 */
import type {
  AssemblePromptPackParams,
  PromptPack,
  PromptPackBlock,
  PromptPackTextMessage,
  PromptPackScenario,
} from '@shared/prompt';
import { promptPackBlockFactory, type ResolvedUserIdentity } from './PromptPackBlockFactory';
import { promptHistoryBuilder } from './PromptHistoryBuilder';
import { promptPackCompiler } from './compiler/PromptPackCompiler';
import { getSystemPromptPreset } from './compiler/systemPromptPresets';
import { renderHostPromptProviderBlock } from './providers';
import { resolvePromptBlockMetadata } from './compiler/promptBlockMetadata';

const AI_CREATE_MOMENT_TOOL_NAME = 'aiCreateMoment';
const MOMENT_AUDIENCE_CANDIDATES_PRESET_ITEM = {
  definitionId: 'context.moment_audience_candidates',
  slot: 'capabilities' as const,
  sortOrder: 85,
  enabled: true,
  required: true,
  protection: 'locked' as const,
};
const MOMENTS_SOCIAL_INBOX_PRESET_ITEM = {
  definitionId: 'context.moments_social_inbox',
  slot: 'dynamic_context' as const,
  sortOrder: 125,
  enabled: true,
  required: false,
  protection: 'locked' as const,
};

export class PromptPackAssembler {
  /** 摘要复用聊天稳定前缀；只读取本次固定来源，动态 provider 与历史查询根本不执行。 */
  async assembleSummaryPromptPack(params: AssemblePromptPackParams, task: PromptPackBlock): Promise<PromptPack> {
    const userIdentity = await promptPackBlockFactory.resolveUserIdentity(params.toolContext);
    const blocks = await this.createStableScenarioBlocks('chat.private_reply', params, userIdentity);
    blocks.push(...(params.additionalBlocks ?? []), task);
    const preset = this.withRuntimeCapabilityPreset(params.preset!, params.allowedToolNames, 'chat.private_reply');
    const currentInput = { role: 'user' as const, content: params.currentInput };
    blocks.push({ key: 'current_input', title: '摘要来源', content: params.currentInput, required: true,
      status: 'ready', truncatable: false, placement: 'input' });
    const includedIds = new Set(blocks.map((block) => resolvePromptBlockMetadata(block, 'chat.summary').definitionId));
    return promptPackCompiler.compile({ scenario: 'chat.summary', blocks, recentMessages: [], currentInput,
      preset: { ...preset, scenarioId: 'chat.summary', items: [...preset.items.filter((item) => includedIds.has(item.definitionId)), {
        definitionId: task.definitionId!, slot: task.slot!, sortOrder: 210, enabled: true, required: true, protection: 'locked',
      }] } });
  }
  async assembleChatPromptPack(params: AssemblePromptPackParams): Promise<PromptPack> {
    return this.assemblePromptPack(this.resolveChatScenario(params), params);
  }

  async assembleLedgerPromptPack(params: AssemblePromptPackParams): Promise<PromptPack> {
    return this.assemblePromptPack('ledger.reply', params);
  }

  private async assemblePromptPack(
    scenario: PromptPackScenario,
    params: AssemblePromptPackParams
  ): Promise<PromptPack> {
    const userIdentity = await promptPackBlockFactory.resolveUserIdentity(params.toolContext);
    // 群聊名称继续采用参与者目录的快照；读取人设不能改变 mention 解析的名称契约。
    if (params.runtimeContext?.groupChat && params.runtimeContext.userDisplayName?.trim()) {
      userIdentity.displayName = params.runtimeContext.userDisplayName.trim();
      userIdentity.source = 'runtimeContext.userDisplayName+userProfileRepository.get';
    }
    const resolvedParams: AssemblePromptPackParams = {
      ...params,
      runtimeContext: {
        ...params.runtimeContext,
        userDisplayName: userIdentity.displayName,
      },
    };
    const blocks = await this.createBlocks(scenario, resolvedParams, userIdentity);
    if (resolvedParams.additionalBlocks?.length) {
      blocks.push(...resolvedParams.additionalBlocks);
    }
    const summaryContext = this.isPrivateConversationScenario(scenario) && !resolvedParams.runtimeContext?.groupChat
      ? await promptHistoryBuilder.loadPrivateSummaryContext(resolvedParams) : null;
    const recentMessages = summaryContext ? summaryContext.messages
      : await promptHistoryBuilder.loadRecentMessages(scenario, resolvedParams);
    if (summaryContext?.summaryContent) blocks.push({
      key: 'conversation_summary', title: '聊天摘要', content: summaryContext.summaryContent, required: false,
      status: 'ready', source: 'ChatSummaryRepository.readContext', truncatable: false, scenario, placement: 'system',
    });
    blocks.push(promptPackBlockFactory.createRecentChatWindowBlock(recentMessages));

    const currentInputMessage: PromptPackTextMessage = {
      role: 'user',
      content: resolvedParams.currentInput,
    };
    blocks.push({
      key: 'current_input',
      title: '当前轮输入',
      content: resolvedParams.currentInput,
      required: true,
      status: 'ready',
      source: 'runtime.currentInput',
      truncatable: false,
      scenario,
      placement: 'input',
    });

    return promptPackCompiler.compile({
      scenario,
      blocks,
      recentMessages,
      currentInput: currentInputMessage,
      preset: this.withRuntimeCapabilityPreset(
        params.preset || getSystemPromptPreset(scenario),
        params.allowedToolNames,
        scenario,
      ),
    });
  }

  private async createBlocks(
    scenario: PromptPackScenario,
    params: AssemblePromptPackParams,
    userIdentity: ResolvedUserIdentity,
  ): Promise<PromptPackBlock[]> {
    return params.runtimeContext?.groupChat
      ? this.createGroupChatBlocks(scenario, params, userIdentity)
      : this.createDefaultScenarioBlocks(scenario, params, userIdentity);
  }

  private async createDefaultScenarioBlocks(
    scenario: PromptPackScenario,
    params: AssemblePromptPackParams,
    userIdentity: ResolvedUserIdentity,
  ): Promise<PromptPackBlock[]> {
    const blocks = await this.createStableScenarioBlocks(scenario, params, userIdentity);

    if (this.hasCurrentTurnVisualContext(params)) {
      blocks.push(promptPackBlockFactory.createVisualGroundingRulesBlock(params.aiConfig));
    }

    if (params.toolsDescription?.trim()) {
      blocks.push(await renderHostPromptProviderBlock('context.tool_explanation', { scenario, params }));
    }

    blocks.push(await renderHostPromptProviderBlock('context.agent_registry', { scenario, params }));

    if (this.hasMomentCreateTool(params.allowedToolNames)) {
      blocks.push(await renderHostPromptProviderBlock('context.moment_audience_candidates', { scenario, params }));
    }

    if (scenario === 'chat.private_reply') {
      blocks.push(await renderHostPromptProviderBlock('context.moments_social_inbox', { scenario, params }));
    }

    const scenarioContextBlock = promptPackBlockFactory.createScenarioContextBlock(scenario);
    if (scenarioContextBlock) blocks.push(scenarioContextBlock);
    blocks.push(promptPackBlockFactory.createTimeAwarenessBlock());
    if (this.isPrivateConversationScenario(scenario)) blocks.push(await renderHostPromptProviderBlock('context.passive_memory', { scenario, params }));
    return blocks;
  }

  private async createStableScenarioBlocks(
    scenario: PromptPackScenario, params: AssemblePromptPackParams, userIdentity: ResolvedUserIdentity,
  ): Promise<PromptPackBlock[]> {
    const blocks: PromptPackBlock[] = [
      promptPackBlockFactory.createFoundationBlock(params.aiConfig, userIdentity.displayName),
      promptPackBlockFactory.createPersonaBlock(params.aiConfig),
      await renderHostPromptProviderBlock('context.protocol_space', { scenario, params }),
      promptPackBlockFactory.createUserIdentityBlock(userIdentity),
    ];
    if (params.toolsDescription?.trim()) {
      blocks.push(await renderHostPromptProviderBlock('context.tools_description', { scenario, params }));
    }

    return blocks;
  }

  private async createGroupChatBlocks(
    scenario: PromptPackScenario,
    params: AssemblePromptPackParams,
    userIdentity: ResolvedUserIdentity,
  ): Promise<PromptPackBlock[]> {
    const blocks = [
      promptPackBlockFactory.createTimeAwarenessBlock(),
      promptPackBlockFactory.createFoundationBlock(params.aiConfig, userIdentity.displayName),
      promptPackBlockFactory.createPersonaBlock(params.aiConfig),
      await renderHostPromptProviderBlock('context.protocol_space', { scenario, params }),
      await renderHostPromptProviderBlock('context.agent_registry', { scenario, params }),
      await renderHostPromptProviderBlock('context.group_chat', { scenario, params }),
      promptPackBlockFactory.createGroupMemberReplyConfidentialityBlock(params.aiConfig, userIdentity.displayName),
      promptPackBlockFactory.createUserIdentityBlock(userIdentity),
      await promptPackBlockFactory.createRecentMomentsBlock(2, params.toolContext, params.aiConfig),
    ];
    if (this.hasCurrentTurnVisualContext(params)) {
      blocks.push(promptPackBlockFactory.createVisualGroundingRulesBlock(params.aiConfig));
    }
    if (this.hasMomentCreateTool(params.allowedToolNames)) {
      blocks.push(await renderHostPromptProviderBlock(
        'context.moment_audience_candidates',
        { scenario, params },
      ));
    }
    return blocks;
  }

  private hasMomentCreateTool(allowedToolNames: readonly string[] | undefined): boolean {
    return allowedToolNames?.includes(AI_CREATE_MOMENT_TOOL_NAME) === true;
  }

  /** 运行时固定上下文不依赖旧预设是否已经包含新版位置。 */
  private withRuntimeCapabilityPreset(
    preset: NonNullable<AssemblePromptPackParams['preset']>,
    allowedToolNames: readonly string[] | undefined,
    scenario: PromptPackScenario,
  ): NonNullable<AssemblePromptPackParams['preset']> {
    const runtimeItems: NonNullable<AssemblePromptPackParams['preset']>['items'] = [
      { definitionId: 'context.protocol_space', slot: 'user_rules' as const, sortOrder: 60, enabled: true, required: false, protection: 'locked' as const },
    ];
    if (this.isPrivateConversationScenario(scenario)) {
      runtimeItems.push(
        { definitionId: 'context.conversation_summary', slot: 'dynamic_context' as const, sortOrder: 160, enabled: true, required: false, protection: 'locked' as const },
        { definitionId: 'context.passive_memory', slot: 'dynamic_context' as const, sortOrder: 180, enabled: true, required: false, protection: 'locked' as const },
      );
    }
    if (this.hasMomentCreateTool(allowedToolNames)) {
      runtimeItems.push(MOMENT_AUDIENCE_CANDIDATES_PRESET_ITEM);
    }
    if (scenario === 'chat.private_reply') {
      runtimeItems.push(MOMENTS_SOCIAL_INBOX_PRESET_ITEM);
    }
    const runtimeDefinitionIds = new Set(runtimeItems.map((item) => item.definitionId));
    return {
      ...preset,
      items: [
        ...preset.items.filter((item) => !runtimeDefinitionIds.has(item.definitionId)),
        ...runtimeItems,
      ],
    };
  }

  private hasCurrentTurnVisualContext(
    params: AssemblePromptPackParams
  ): boolean {
    return Boolean(
      params.runtimeContext?.capabilities?.some((capability) => capability.startsWith('vision.'))
      || params.currentInput.includes('[视觉输入状态：')
    );
  }

  private isPrivateConversationScenario(scenario: PromptPackScenario): boolean {
    return scenario === 'chat.private_reply' || scenario === 'call.live_reply' || scenario === 'call.outgoing_decision';
  }

  private resolveChatScenario(
    params: AssemblePromptPackParams
  ): PromptPackScenario {
    if (params.runtimeContext?.groupChat) {
      return 'chat.group_member_reply';
    }
    if (params.runtimeContext?.triggerSource === 'call_outgoing_decision') {
      return 'call.outgoing_decision';
    }
    if (params.runtimeContext?.triggerSource === 'call') {
      return 'call.live_reply';
    }
    return 'chat.private_reply';
  }
}

export const promptPackAssembler = new PromptPackAssembler();
