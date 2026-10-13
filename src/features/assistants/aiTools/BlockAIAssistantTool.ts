/**
 * @fileoverview BlockAIAssistantTool - 将指定AI助手暂时拉黑
 * 【主理AI专属】执行副作用前必须确认 actor 仍是当前主理 AI
 * @module features/assistants/aiTools/BlockAIAssistantTool
 */

import { aiAssistantRepository } from '../infrastructure/SQLiteAssistantRepository';
import { aiHostRepository } from '../infrastructure/SQLiteHostRepository';
import { runAsCurrentHostAuthority } from '../AIAssistantManagement';
import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';

interface BlockAIAssistantArgs {
  targetAgentId?: string;
  durationMinutes?: number;
  reason?: string;
}

interface ToolResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: Record<string, unknown> | null;
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'blockAIAssistant',
  description: '将指定AI助手暂时拉黑',
  parameters: {
    type: 'object',
    properties: {
      targetAgentId: { type: 'string', description: '要拉黑的 AI 的 agentId（稳定身份 ID）' },
      durationMinutes: {
        type: 'number',
        description: '拉黑时长（分钟），1-1440',
        minimum: 1,
        maximum: 1440,
      },
      reason: { type: 'string', description: '拉黑原因' },
    },
    required: ['targetAgentId', 'durationMinutes'],
  },
} as const;

/**
 * 执行工具
 */
export async function execute(
  args: BlockAIAssistantArgs,
  context: ToolContext
): Promise<ToolResult> {
  const { targetAgentId, durationMinutes, reason } = args;

  if (!context.isHostAI()) {
    return { success: false, error: '只有主理AI才能使用此工具' };
  }

  if (!targetAgentId) {
    return { success: false, error: '缺少目标 AI 的 agentId' };
  }

  if (!durationMinutes || durationMinutes < 1 || durationMinutes > 1440) {
    return { success: false, error: '拉黑时长必须在1-1440分钟之间' };
  }

  const hostAiId = context.getAIId();
  const hostAgentId = context.getAgentId();
  if (!hostAiId) {
    return { success: false, error: '未识别到当前主理AI身份' };
  }

  if (hostAgentId && hostAgentId === targetAgentId) {
    return { success: false, error: '主理AI不能拉黑自己' };
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

      if (targetAI.id === hostAiId) {
        return { success: false, error: '主理AI不能拉黑自己' };
      }

      if (targetAI.isHostAI) {
        return { success: false, error: '不能拉黑当前主理AI' };
      }

      const blockedState = await aiHostRepository.isAIBlocked(targetAI.id);
      if (blockedState.isBlocked && blockedState.blockInfo) {
        return {
          success: true,
          message: `${targetAI.name} 已处于拉黑状态，截止时间：${formatTime(blockedState.blockInfo.blockedUntil)}`,
          data: {
            aiName: targetAI.name,
            targetAgentId: targetAI.agentId,
            blockedUntil: blockedState.blockInfo.blockedUntil,
            reason: blockedState.blockInfo.reason || '',
          },
        };
      }

      throwIfAbortSignalAborted(context.abortSignal);
      const blockedUntilDate = new Date(Date.now() + durationMinutes * 60 * 1000);
      const blockInfo = await aiHostRepository.blockAI({
        aiId: targetAI.id,
        blockedByAIId: hostAiId,
        blockedUntil: blockedUntilDate.toISOString(),
        reason: reason || '',
      });

      return {
        success: true,
        message: `已将 ${targetAI.name} 拉黑 ${durationMinutes} 分钟${reason ? `，原因：${reason}` : ''}`,
        data: {
          aiName: targetAI.name,
          targetAgentId: targetAI.agentId,
          blockedUntil: blockInfo.blockedUntil,
          reason: blockInfo.reason || '',
        },
      };
    });

    return authorityResult.status === 'authorized'
      ? authorityResult.value
      : { success: false, error: '当前 AI 已不再是主理AI' };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    console.error('[BlockAIAssistantTool] Failed:', error);
    return { success: false, error: '拉黑 AI 助手失败' };
  }
}

function formatTime(value?: string | null): string {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 工具对象（定义 + 执行）
 */
export const BlockAIAssistantTool = {
  name: definition.name,
  definition,
  execute,
};
