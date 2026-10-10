/** 读取完整时刻和评论区，向模型提供后续互动与纠错所需的稳定 ID。 */
import type { MomentToolContext } from './MomentToolContext';
import { MomentDomainError } from '../domain/MomentErrors';
import { readMomentForTool } from './MomentReading';

interface GetMomentDetailArgs { momentId: string }

export const definition = {
  name: 'getMomentDetail',
  description: '读取时刻完整正文、图片语义、评论区与点赞状态，返回 momentId、各 commentId、回复目标、自己的评论 ID 和本轮 readReceipt。回复或删评论直接用返回的内部 commentId。',
  parameters: {
    type: 'object' as const,
    properties: { momentId: { type: 'string' as const, minLength: 1, description: '时刻 ID，从 searchMoments 或 Social Inbox 获取' } },
    required: ['momentId'],
    additionalProperties: false,
  },
};

export async function execute(args: GetMomentDetailArgs, context: MomentToolContext) {
  if (!args.momentId) return { success: false, error: '缺少时刻动态ID' };
  const agentId = context.getAgentId()?.trim();
  if (!agentId) return { success: false, error: 'AI 身份缺少不可变 agentId，无法读取时刻' };
  try {
    return await readMomentForTool(context, agentId, args.momentId);
  } catch (error) {
    if (error instanceof MomentDomainError && error.code === 'moment_not_visible') {
      return { success: false, error: '未找到该时刻' };
    }
    console.error('[GetMomentDetailTool] Failed:', error);
    return { success: false, error: '获取时刻详情失败' };
  }
}

export const GetMomentDetailTool = { name: definition.name, definition, execute };
