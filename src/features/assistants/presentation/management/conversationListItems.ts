/**
 * 统一会话列表项模型。
 *
 * AI 单聊与群聊在列表里是同一种列表项：顺序只由
 * `@shared/utils/conversationListOrdering` 决定（pinned 分区 → 可见消息活动 →
 * createdAt → id）。本模块是纯函数，UI 组件只负责渲染，不参与排序。
 *
 * `lastActivityAt` 取最后一条**可见**消息时间：
 * - 单聊读 `sessions.last_time`（AIProfile.lastTime，来自 canonical 会话 JOIN）；
 * - 群聊读 `group_chats.last_time`。
 * 为空表示当前可见时间线没有消息（从未有过 / 已 clear / 可见消息被删空），
 * 此时排序回落到 createdAt，而不是保留已被隐藏消息的时间。
 *
 * `pinnedAt` 是最近一次置顶时刻，**只在置顶区参与排序**（取 max(消息活动, pinnedAt)），
 * 于是刚置顶立刻浮到置顶区顶部，取消置顶后完全按真实消息排序。
 */

import type { AIProfile } from '../../domain/AIProfile';
import type { GroupChat } from '@features/chat';
import { sortConversationOrdering } from '@shared/utils/conversationListOrdering';

export type ConversationListItem =
  | {
      kind: 'direct';
      id: string;
      isPinned: boolean;
      lastActivityAt: string | null;
      pinnedAt: string | null;
      createdAt: string;
      ai: AIProfile;
    }
  | {
      kind: 'group';
      id: string;
      isPinned: boolean;
      lastActivityAt: string | null;
      pinnedAt: string | null;
      createdAt: string;
      group: GroupChat;
    };

export interface BuildConversationListItemsParams {
  aiList?: AIProfile[];
  groupChats?: GroupChat[];
}

export function buildConversationListItems({
  aiList = [],
  groupChats = [],
}: BuildConversationListItemsParams): ConversationListItem[] {
  const items: ConversationListItem[] = [
    ...aiList.map((ai) => ({
      kind: 'direct' as const,
      id: ai.id,
      isPinned: ai.isPinned === true,
      lastActivityAt: ai.lastTime || null,
      pinnedAt: ai.pinnedAt || null,
      createdAt: ai.createdAt,
      ai,
    })),
    ...groupChats.map((group) => ({
      kind: 'group' as const,
      id: group.id,
      isPinned: group.isPinned === true,
      lastActivityAt: group.lastTime || null,
      pinnedAt: group.pinnedAt || null,
      createdAt: group.createdAt,
      group,
    })),
  ];

  return sortConversationOrdering(items);
}
