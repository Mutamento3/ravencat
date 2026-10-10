/**
 * @fileoverview UnblockAIAssistantTool - 解除指定 AI 的拉黑状态
 * 【主理AI专属】执行副作用前必须确认 actor 仍是当前主理 AI
 * @module features/assistants/aiTools/UnblockAIAssistantTool
 */

import { aiAssistantRepository } from '../infrastructure/SQLiteAssistantRepository';
import { aiHostRepository } from '../infrastructure/SQLiteHostRepository';
import { runAsCurrentHostAuthority } from '../AIAssistantManagement';
import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';

interface UnblockAIAssistantArgs {
  targetAgentId?: string;
}

interface ToolResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown> | null;
}

export const definition = {
  name: 'unblockAIAssistant',
  description: '【主理AI专属】解除指定 AI 助手的拉黑状态',
  parameters: {
    type: 'object',
    properties: {
      targetAgentId: { type: 'string', description: '要解除拉黑的 AI 的 agentId（稳定身份 ID）' },
    },
    required: ['targetAgentId'],
  },
} as const;

export async function execute(
  args: UnblockAIAssistantArgs,
  context: ToolContext
): Promise<ToolResult> {
  const { targetAgentId } = args;

  if (!context.isHostAI()) {
    return { success: false, error: '只有主理AI才能使用此工具' };
  }

  if (!targetAgentId) {
    return { success: false, error: '缺少目标 AI 的 agentId' };
  }

  const hostAiId = context.getAIId();
  if (!hostAiId) {
    return { success: false, error: '未识别到当前主理AI身份' };
  }

  try {
    const authorityResult = await runAsCurrentHostAuthority(hostAiId, async () => {
      throwIfAbortSignalAborted(context.abortSignal);
      await aiHostRepository.cleanupExpiredBlocks();

      // 注意：这里对模型只暴露 agentId；aiId 仅在系统执行层内部使用。
      const assistants = await aiAssistantRepository.getAll();
      const targetAI = assistants.find((assistant) => assistant.agentId === targetAgentId);
      if (!targetAI) {
        return { success: false, error: '未找到对应 agentId 的目标 AI' };
      }

      const blockedState = await aiHostRepository.isAIBlocked(targetAI.id);
      if (!blockedState.isBlocked || !blockedState.blockInfo) {
        return { success: true, message: `${targetAI.name} 当前未被拉黑` };
      }

      throwIfAbortSignalAborted(context.abortSignal);
      await aiHostRepository.unblockAI(blockedState.blockInfo.id);

      return {
        success: true,
        message: `已解除 ${targetAI.name} 的拉黑状态`,
        data: {
          targetAgentId: targetAI.agentId,
          aiName: targetAI.name,
        },
      };
    });

    return authorityResult.status === 'authorized'
      ? authorityResult.value
      : { success: false, error: '当前 AI 已不再是主理AI' };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    console.error('[UnblockAIAssistantTool] Failed:', error);
    return { success: false, error: '解除拉黑失败' };
  }
}

export const UnblockAIAssistantTool = {
  name: definition.name,
  definition,
  execute,
};
