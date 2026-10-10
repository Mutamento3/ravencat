/** 估算 Prompt token，并在超过提醒阈值时记录诊断；不改写运行时内容。 */
import {
  estimateTextTokens,
  type PromptPackBlock,
  type PromptPackMessage,
  type PromptPackMessageContent,
} from '@shared/prompt';

export function estimateTokens(text: string): number {
  return estimateTextTokens(text);
}

export const DEFAULT_TOKEN_BUDGET = 12000;

function estimateMessageContentTokens(content: PromptPackMessageContent): number {
  if (typeof content === 'string') {
    return estimateTokens(content);
  }
  return content.reduce((sum, part) => (
    sum + (part.type === 'text' ? estimateTokens(part.text) : 0)
  ), 0);
}

export interface ApplyTokenBudgetResult {
  blocks: PromptPackBlock[];
  recentMessages: PromptPackMessage[];
  truncationLog: string[];
  estimatedTokenCount: number;
}

export function applyTokenBudget(
  blocks: PromptPackBlock[],
  recentMessages: PromptPackMessage[],
  currentInputMessage: PromptPackMessage | null,
  budget = DEFAULT_TOKEN_BUDGET
): ApplyTokenBudgetResult {
  const log: string[] = [];

  function computeTokens(currentBlocks: PromptPackBlock[], currentRecentMessages: PromptPackMessage[]) {
    const blocksTokens = currentBlocks.reduce((sum, block) => {
      return block.placement === 'system' ? sum + estimateTokens(block.content) : sum;
    }, 0);
    const modelMessages = currentInputMessage
      ? [...currentRecentMessages, currentInputMessage]
      : currentRecentMessages;
    const modelMessagesTokens = modelMessages.reduce((sum, msg) => {
      return sum + estimateMessageContentTokens(msg.content);
    }, 0);
    return Math.ceil(blocksTokens + modelMessagesTokens);
  }

  const workingBlocks = blocks.map((block) => ({ ...block }));
  const workingRecentMessages = recentMessages.slice();
  const totalTokens = computeTokens(workingBlocks, workingRecentMessages);
  if (totalTokens > budget) {
    log.push(`WARNING: Token count ${totalTokens} exceeds configured threshold ${budget}; no prompt blocks or history messages were removed.`);
  }

  return {
    blocks: workingBlocks,
    recentMessages: workingRecentMessages,
    truncationLog: log,
    estimatedTokenCount: totalTokens,
  };
}
