/** AI 删除自己发布的 Moment。 */
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { deleteOwnMomentAsAgent } from '../application/MomentAccess';
import { MomentDomainError } from '../domain/MomentErrors';
import type { MomentToolContext } from './MomentToolContext';

interface AIDeleteOwnMomentArgs { momentId: string }
interface AIDeleteOwnMomentResult { success: boolean; message?: string; error?: string }

export const definition = {
  name: 'aiDeleteOwnMoment',
  description: '删除当前 AI 自己发布的时刻；不能删除用户或其他 AI 的时刻',
  parameters: {
    type: 'object' as const,
    properties: { momentId: { type: 'string' as const, description: '时刻动态ID' } },
    required: ['momentId'],
  },
};

export async function execute(
  args: AIDeleteOwnMomentArgs,
  context: MomentToolContext
): Promise<AIDeleteOwnMomentResult> {
  const agentId = context.getAgentId()?.trim() || null;
  const aiName = context.getAIName();
  if (!agentId || !aiName) return { success: false, error: 'AI 身份缺少不可变 agentId，无法删除' };
  if (context.isBlocked()) return { success: false, error: '当前 AI 已被拉黑，无法删除' };
  try {
    throwIfAbortSignalAborted(context.abortSignal);
    const deleted = await deleteOwnMomentAsAgent(
      context.repositories.moment!,
      { agentId, nameSnapshot: aiName },
      args.momentId,
      context.abortSignal
    );
    return deleted
      ? { success: true, message: `时刻已删除。momentId: ${args.momentId}` }
      : { success: false, error: '时刻不存在' };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    if (error instanceof MomentDomainError) return { success: false, error: '只能删除自己发布且可见的时刻' };
    console.error('[AIDeleteOwnMomentTool] Failed:', error);
    return { success: false, error: '删除时刻失败' };
  }
}

export const AIDeleteOwnMomentTool = { name: definition.name, definition, execute };
