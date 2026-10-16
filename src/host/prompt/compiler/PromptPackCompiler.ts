/** 将解析后的 Block 实例按预设编译成唯一的最终 Prompt Pack。 */

import type {
  ChatPromptReadingStep,
  PromptPack,
  PromptPackBlock,
  PromptPackMessage,
  PromptPackScenario,
  PromptPackTextMessage,
  PromptPresetDefinition,
  PromptToolInstructionsSlot,
} from '@shared/prompt';
import { CHAT_PROMPT_READING_FLOW } from '@shared/prompt';
import { applyTokenBudget, estimateTokens } from '../tokenBudget';
import { resolvePromptBlockMetadata } from './promptBlockMetadata';

interface CompilePromptPackParams {
  scenario: PromptPackScenario;
  blocks: PromptPackBlock[];
  recentMessages: PromptPackMessage[];
  currentInput: PromptPackTextMessage | null;
  preset: PromptPresetDefinition;
}

const SLOT_FALLBACK_ORDER = {
  foundation: 1, persona: 2, user_rules: 3, scenario: 4, capabilities: 5,
  dynamic_context: 6, output_contract: 7, history: 8, input: 9,
} as const;

const READING_STEP_ORDER = new Map<ChatPromptReadingStep, number>(CHAT_PROMPT_READING_FLOW.map((step, index) => [step.id, index]));
const READING_BLOCK_ORDER = new Map<PromptPackBlock['key'], number>(CHAT_PROMPT_READING_FLOW.flatMap((step, index) => (
  step.blockKeys.map((key) => [key, index] as const)
)));
const SLOT_READING_STEP: Record<NonNullable<PromptPackBlock['slot']>, ChatPromptReadingStep> = {
  foundation: 'foundation', persona: 'persona', user_rules: 'custom', scenario: 'custom',
  capabilities: 'tools', dynamic_context: 'environment', output_contract: 'output', history: 'history', input: 'input',
};

type NormalizedPromptBlock = PromptPackBlock & Required<Pick<PromptPackBlock, 'definitionId' | 'instanceId' | 'slot'>>;

function chatReadingOrder(block: NormalizedPromptBlock): number {
  // 自定义片段沿用自己的列表排序，但整体位置由提示词中心的“自定义提示词”决定。
  if (block.definitionId.startsWith('assistant-user:') || block.instanceId.startsWith('custom:')) {
    return READING_STEP_ORDER.get('custom')!;
  }
  const mapped = block.key === 'persona' && block.definitionId !== 'persona.assistant'
    ? undefined : READING_BLOCK_ORDER.get(block.key);
  if (mapped !== undefined) return mapped;
  // 未在中心单列的场景内部规则仍归所属插槽，不把机器输出契约解释为人设。
  return READING_STEP_ORDER.get(SLOT_READING_STEP[block.slot])!;
}

function resolveSystemSegment(block: PromptPackBlock): NonNullable<PromptPackBlock['systemSegment']> {
  // 场景所有者可明确把通话状态放到历史之后，不能再按 slot 把它塞回稳定前缀。
  if (block.systemSegment) return block.systemSegment;
  if (block.key === 'conversation_summary') return 'conversation-summary';
  if (block.key === 'tool_context_explanation') return 'dynamic-suffix';
  if (block.slot === 'output_contract') return 'output-requirement';
  if (block.slot === 'foundation' || block.slot === 'persona' || block.slot === 'user_rules' || block.slot === 'scenario' || block.slot === 'capabilities') {
    return 'stable-prefix';
  }
  return 'dynamic-suffix';
}

function renderSystemSegment(blocks: PromptPackBlock[], segment: NonNullable<PromptPackBlock['systemSegment']>): string {
  return blocks
    .filter((block) => block.placement === 'system' && block.systemSegment === segment && block.content.trim())
    .map((block) => block.content.trim())
    .join('\n\n');
}

function compileToolInstructionsSlot(
  blocks: PromptPackBlock[],
  segments: readonly NonNullable<PromptPackBlock['systemSegment']>[],
): PromptToolInstructionsSlot | undefined {
  const systemBlocks = segments.flatMap((segment) => blocks.filter((block) => (
    block.placement === 'system' && block.systemSegment === segment && block.content.trim()
  )));
  const toolBlockIndex = systemBlocks.findIndex((block) => block.key === 'tools_description');
  // 未启用工具说明的预设不另建目录注入位置。
  if (toolBlockIndex === -1) return undefined;
  return {
    before: systemBlocks.slice(0, toolBlockIndex + 1).map((block) => block.content.trim()).join('\n\n'),
    after: systemBlocks.slice(toolBlockIndex + 1).map((block) => block.content.trim()).join('\n\n'),
  };
}

function blockAssemblyOrder(block: PromptPackBlock): number {
  if (block.placement === 'history') return 3;
  if (block.placement === 'input') return 6;
  switch (block.systemSegment) {
    case 'stable-prefix': return 1;
    case 'conversation-summary': return 2;
    case 'history-context': return 3;
    case 'dynamic-suffix': return 4;
    case 'output-requirement': return 5;
    default: return 7;
  }
}

export class PromptPackCompiler {
  compile(params: CompilePromptPackParams): PromptPack {
    if (params.preset.scenarioId !== params.scenario) {
      throw new Error(`提示词预设场景不匹配：${params.preset.id}`);
    }
    const blocks = this.normalizeAndOrderBlocks(params.blocks, params.scenario, params.preset);
    this.validateRequiredBlocks(blocks, params.preset);
    const blocksWithTokens = blocks.map((block) => ({
      ...block,
      estimatedTokens: estimateTokens(block.content),
    }));
    const budgetResult = applyTokenBudget(
      blocksWithTokens,
      params.recentMessages,
      params.currentInput,
      params.preset.tokenBudget
    );
    const stableSystemPrompt = renderSystemSegment(budgetResult.blocks, 'stable-prefix');
    const summaryPrompt = renderSystemSegment(budgetResult.blocks, 'conversation-summary');
    const dynamicSystemPrompt = renderSystemSegment(budgetResult.blocks, 'dynamic-suffix');
    const outputRequirement = renderSystemSegment(budgetResult.blocks, 'output-requirement');
    const currentContext = [dynamicSystemPrompt, outputRequirement].filter(Boolean).join('\n\n');
    const toolInstructionsSlot = compileToolInstructionsSlot(
      budgetResult.blocks, ['stable-prefix', 'conversation-summary'],
    );
    return {
      scenario: params.scenario,
      blocks: budgetResult.blocks,
      systemPrompt: [stableSystemPrompt, summaryPrompt].filter(Boolean).join('\n\n'),
      toolInstructionsSlot,
      stableSystemPrompt,
      dynamicSystemPrompt,
      outputRequirement,
      recentMessages: budgetResult.recentMessages,
      currentInput: params.currentInput,
      modelMessages: [
        ...budgetResult.recentMessages,
        ...(currentContext ? [{
          role: 'system' as const,
          content: currentContext,
        }] : []),
        ...(params.currentInput ? [params.currentInput] : []),
      ],
      estimatedTokenCount: budgetResult.estimatedTokenCount,
      truncationLog: budgetResult.truncationLog,
    };
  }

  private normalizeAndOrderBlocks(
    drafts: PromptPackBlock[],
    scenario: PromptPackScenario,
    preset: PromptPresetDefinition
  ): NormalizedPromptBlock[] {
    const instanceCounts = new Map<string, number>();
    const presetOrder = new Map(
      preset.items.filter((item) => item.enabled).map((item) => [item.definitionId, item.sortOrder])
    );
    const enabledDefinitionIds = new Set(
      preset.items.filter((item) => item.enabled).map((item) => item.definitionId)
    );
    return drafts.map((draft) => {
      const metadata = resolvePromptBlockMetadata(draft, scenario);
      const nextCount = (instanceCounts.get(metadata.definitionId) || 0) + 1;
      instanceCounts.set(metadata.definitionId, nextCount);
      return {
        ...draft,
        instanceId: draft.instanceId || `${metadata.definitionId}:${nextCount}`,
        definitionId: metadata.definitionId,
        slot: metadata.slot,
        protection: metadata.protection,
        systemSegment: draft.placement === 'system' ? resolveSystemSegment({ ...draft, ...metadata }) : undefined,
      };
    }).filter((block) => (
      enabledDefinitionIds.has(block.definitionId || '')
      || block.definitionId?.startsWith('assistant-user:')
    ))
      .sort((left, right) => {
      // 消息角色边界保持不变；普通聊天段内顺序与提示词中心共用同一份定义。
      const assemblyOrder = blockAssemblyOrder(left) - blockAssemblyOrder(right);
      if (assemblyOrder !== 0) return assemblyOrder;
      if (scenario === 'chat.private_reply' || scenario === 'chat.group_member_reply' || scenario === 'ledger.reply') {
        const readingOrder = chatReadingOrder(left) - chatReadingOrder(right);
        if (readingOrder !== 0) return readingOrder;
      }
      const leftSlotOrder = SLOT_FALLBACK_ORDER[left.slot];
      const rightSlotOrder = SLOT_FALLBACK_ORDER[right.slot];
      if (leftSlotOrder !== rightSlotOrder) return leftSlotOrder - rightSlotOrder;
      const currentFactOrder = (block: PromptPackBlock) => block.key === 'device_battery' ? 1
        : block.key === 'time_awareness' ? 2 : 0;
      const currentFactDifference = currentFactOrder(left) - currentFactOrder(right);
      if (currentFactDifference !== 0) return currentFactDifference;
      const leftOrder = presetOrder.get(left.definitionId || '') ?? 1000;
      const rightOrder = presetOrder.get(right.definitionId || '') ?? 1000;
      return leftOrder - rightOrder;
    });
  }

  private validateRequiredBlocks(
    blocks: PromptPackBlock[],
    preset: PromptPresetDefinition
  ): void {
    const enabledDefinitionIds = new Set(
      blocks.filter((block) => block.status === 'ready' && block.content.trim())
        .map((block) => block.definitionId)
    );
    const missing = preset.items
      .filter((item) => item.enabled && item.required && item.protection === 'locked')
      .filter((item) => !enabledDefinitionIds.has(item.definitionId))
      .map((item) => item.definitionId);
    if (missing.length > 0) {
      throw new Error(`提示词预设缺少必需受保护定义：${missing.join(', ')}`);
    }
    const invalidRequiredBlock = blocks.find((block) => (
      block.required && block.status !== 'ready'
    ));
    if (invalidRequiredBlock) {
      throw new Error(`必需 Prompt Block 未就绪：${invalidRequiredBlock.definitionId}`);
    }
  }
}

export const promptPackCompiler = new PromptPackCompiler();
