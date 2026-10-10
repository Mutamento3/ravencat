/** 重新查看当前执行 AI 的未读 Social Inbox 摘要；查看摘要本身不消费事件。 */

import { formatSocialInboxSummary, loadSocialInboxSummary } from '../application/SocialInboxSummary';
import type { MomentToolContext } from './MomentToolContext';

interface ReadSocialInboxArgs {
  limit?: number;
  cursor?: number;
}

export const definition = {
  name: 'readSocialInbox',
  description: '查看与你有关的未读时刻社交待办；摘要不会标记已读，读详情用 getMomentDetail。查已读或旧时刻用 searchMoments。',
  parameters: {
    type: 'object' as const,
    properties: {
      limit: { type: 'integer' as const, description: '每页摘要组数，默认20，最多50', default: 20, minimum: 1, maximum: 50 },
      cursor: { type: 'integer' as const, minimum: 1, description: '下一页原样传回上次返回的 nextCursor；查看最新待办时省略' },
    },
    required: [],
    additionalProperties: false,
  },
};

export async function execute(args: ReadSocialInboxArgs, context: MomentToolContext) {
  const agentId = context.getAgentId()?.trim() || null;
  if (!agentId) return { success: false, error: 'AI 身份缺少不可变 agentId，无法读取 Social Inbox' };
  const limit = args.limit ?? 20;
  try {
    const summary = await loadSocialInboxSummary(context.repositories.moment!, agentId, {
      groupLimit: limit,
      beforeDeliverySeq: args.cursor,
    });
    return {
      success: true,
      message: summary.totalUnreadCount === 0
        ? 'Social Inbox 当前没有未读事件。'
        : `${formatSocialInboxSummary(summary)}\nnextCursor: ${JSON.stringify(summary.nextCursor)}\n${summary.nextCursor === null ? '当前查询已到末页。' : '还有下一页，可用此 nextCursor 继续读取摘要。'}`,
      data: summary,
    };
  } catch (error) {
    console.error('[ReadSocialInboxTool] Failed:', error);
    return { success: false, error: '读取 Social Inbox 失败' };
  }
}

export const ReadSocialInboxTool = { name: definition.name, definition, execute };
