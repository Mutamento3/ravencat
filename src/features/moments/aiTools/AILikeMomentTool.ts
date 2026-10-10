/**
 * @fileoverview 为指定时刻点赞的 AI 工具
 * @module features/moments/aiTools/AILikeMomentTool
 */

import type { MomentToolContext } from './MomentToolContext';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { MomentDomainError } from '../domain/MomentErrors';
import { likeMomentAsAgent } from '../application/MomentAccess';
import { hasMomentReadReceipt, readMomentForTool } from './MomentReading';

/**
 * 工具参数接口
 */
interface AILikeMomentArgs {
  momentId: string;
  readReceipt?: string;
}

/**
 * 工具执行结果接口
 */
interface AILikeMomentResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: unknown;
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'aiLikeMoment',
  description: '看过完整时刻后再点赞；没读内容不要点赞。省略 readReceipt 时只返回正文、图片语义与评论区，不算点赞。',
  parameters: {
    type: 'object' as const,
    properties: {
      momentId: { type: 'string' as const, description: '时刻动态ID' },
      readReceipt: { type: 'string' as const, description: '本轮 getMomentDetail 或本工具预览返回的 readReceipt，原样传回；省略时只读取详情，不点赞' },
    },
    required: ['momentId'],
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 执行结果
 */
export async function execute(
  args: AILikeMomentArgs,
  context: MomentToolContext
): Promise<AILikeMomentResult> {
  const { momentId } = args;
  const aiName = context.getAIName();
  const agentId = context.getAgentId()?.trim() || null;

  if (!momentId) {
    return { success: false, error: '缺少时刻动态ID' };
  }

  if (!aiName) {
    return { success: false, error: '未指定AI身份' };
  }

  if (!agentId) {
    return { success: false, error: 'AI 身份缺少不可变 agentId，无法点赞' };
  }

  if (context.isBlocked()) {
    return { success: false, error: '当前 AI 已被拉黑，无法点赞' };
  }

  try {
    throwIfAbortSignalAborted(context.abortSignal);
    if (!hasMomentReadReceipt(context, agentId, momentId, args.readReceipt)) {
      const preview = await readMomentForTool(context, agentId, momentId);
      return {
        success: true,
        message: `尚未点赞。请先阅读以下完整详情，再决定是否用返回的 readReceipt 再次调用 aiLikeMoment。\n\n${preview.message}`,
        data: { action: 'preview', ...preview.data },
      };
    }
    // 重复点赞由唯一约束拒绝并返回 null；可见性断言在写路径内部完成。
    const like = await likeMomentAsAgent(
      context.repositories.moment!,
      { agentId, nameSnapshot: aiName },
      momentId,
      context.abortSignal
    );

    if (!like) {
      return { success: true, message: `你已经点赞过这条时刻，无需重复操作。momentId: ${momentId}`, data: { action: 'already_liked', momentId } };
    }

    return { success: true, message: `点赞成功。momentId: ${momentId}`, data: { action: 'liked', momentId } };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    if (error instanceof MomentDomainError && error.code === 'moment_not_visible') {
      return { success: false, error: '未找到该时刻' };
    }
    console.error('[AILikeMomentTool] Failed:', error);
    return { success: false, error: '点赞失败' };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const AILikeMomentTool = {
  name: definition.name,
  definition,
  execute,
};
