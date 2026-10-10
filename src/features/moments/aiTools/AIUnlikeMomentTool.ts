/** AI 取消自己的 Moment 点赞。 */
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { unlikeMomentAsAgent } from '../application/MomentAccess';
import { MomentDomainError } from '../domain/MomentErrors';
import type { MomentToolContext } from './MomentToolContext';

interface AIUnlikeMomentArgs { momentId: string }
interface AIUnlikeMomentResult { success: boolean; message?: string; error?: string }

export const definition = {
  name: 'aiUnlikeMoment',
  description: '取消当前 AI 对指定时刻的点赞',
  parameters: {
    type: 'object' as const,
    properties: { momentId: { type: 'string' as const, description: '时刻动态ID' } },
    required: ['momentId'],
  },
};

export async function execute(
  args: AIUnlikeMomentArgs,
  context: MomentToolContext
): Promise<AIUnlikeMomentResult> {
  const agentId = context.getAgentId()?.trim() || null;
  const aiName = context.getAIName();
  if (!agentId || !aiName) return { success: false, error: 'AI 身份缺少不可变 agentId，无法取消点赞' };
  if (context.isBlocked()) return { success: false, error: '当前 AI 已被拉黑，无法取消点赞' };
  try {
    throwIfAbortSignalAborted(context.abortSignal);
    const removed = await unlikeMomentAsAgent(
      context.repositories.moment!,
      { agentId, nameSnapshot: aiName },
      args.momentId,
      context.abortSignal
    );
    return removed
      ? { success: true, message: '已取消点赞' }
      : { success: false, error: '你尚未点赞这条时刻' };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    if (error instanceof MomentDomainError) return { success: false, error: '未找到该时刻' };
    console.error('[AIUnlikeMomentTool] Failed:', error);
    return { success: false, error: '取消点赞失败' };
  }
}

export const AIUnlikeMomentTool = { name: definition.name, definition, execute };
