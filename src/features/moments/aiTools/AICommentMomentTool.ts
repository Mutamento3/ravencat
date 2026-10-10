/**
 * @fileoverview 为指定时刻发表评论的 AI 工具
 * @module features/moments/aiTools/AICommentMomentTool
 */

import type { MomentToolContext } from './MomentToolContext';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { MomentDomainError } from '../domain/MomentErrors';
import { commentMomentAsAgent } from '../application/MomentAccess';

/**
 * 工具参数接口
 */
interface AICommentMomentArgs {
  momentId: string;
  content: string;
}

/**
 * 工具执行结果接口
 */
interface AICommentMomentResult {
  success: boolean;
  message?: string;
  error?: string;
  data?: { momentId: string; commentIds: string[] };
}

/**
 * 工具定义（JSON Schema）
 */
export const definition = {
  name: 'aiCommentMoment',
  description: '为时刻发表评论。先用 getMomentDetail 读取正文与评论区，再基于真实内容发表评论；结果提供新建 commentId，可直接用于撤回。要回复某条评论请使用 aiReplyMomentComment。',
  parameters: {
    type: 'object' as const,
    properties: {
      momentId: { type: 'string' as const, description: '时刻动态ID' },
      content: { type: 'string' as const, description: '评论内容', maxLength: 500 },
    },
    required: ['momentId', 'content'],
  },
};

/**
 * 执行工具
 * @param args - 工具参数
 * @param context - 工具执行上下文
 * @returns 执行结果
 */
export async function execute(
  args: AICommentMomentArgs,
  context: MomentToolContext
): Promise<AICommentMomentResult> {
  const { momentId, content } = args;
  const aiName = context.getAIName();
  const agentId = context.getAgentId()?.trim() || null;

  if (!momentId) {
    return { success: false, error: '缺少时刻动态ID' };
  }

  if (!content?.trim()) {
    return { success: false, error: '评论内容不能为空' };
  }

  if (!aiName) {
    return { success: false, error: '未指定AI身份' };
  }

  if (!agentId) {
    return { success: false, error: 'AI 身份缺少不可变 agentId，无法评论' };
  }

  if (context.isBlocked()) {
    return { success: false, error: '当前 AI 已被拉黑，无法评论' };
  }

  try {
    throwIfAbortSignalAborted(context.abortSignal);
    // 作者身份来自 ToolContext 的不可变 agentId；模型不能指定 authorId。
    const comments = await commentMomentAsAgent(
      context.repositories.moment!,
      { agentId, nameSnapshot: aiName },
      momentId,
      [content],
      context.abortSignal
    );

    return {
      success: true,
      message: `评论成功。momentId: ${momentId}\n${comments.map((comment) => `commentId: ${comment.id}，parentCommentId: null\n内容: ${comment.content}`).join('\n')}\n需要撤回时直接用此 commentId 调用 aiDeleteOwnMomentComment。`,
      data: { momentId, commentIds: comments.map((comment) => comment.id) },
    };
  } catch (error) {
    throwIfAbortSignalAborted(context.abortSignal);
    if (error instanceof MomentDomainError) {
      if (error.code === 'moment_not_visible') {
        return { success: false, error: '未找到该时刻' };
      }
      if (error.code === 'empty_content') {
        return { success: false, error: '评论内容不能为空' };
      }
    }
    console.error('[AICommentMomentTool] Failed:', error);
    return { success: false, error: '评论失败' };
  }
}

/**
 * 工具对象（定义 + 执行）
 */
export const AICommentMomentTool = {
  name: definition.name,
  definition,
  execute,
};
