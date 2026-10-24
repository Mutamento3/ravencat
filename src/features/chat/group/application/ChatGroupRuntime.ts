/** 群聊应用运行时依赖：由 Chat composition 注入群聊仓储。 */

import type { IGroupChatRepository } from '../domain/GroupChatRepository';
import type { GroupMembershipRepository } from '../domain/GroupMembership';
import type { ChatSummaryRepository } from '../../summary/domain/ChatSummaryRepository';
import type { ChatAssistantDirectory } from '../../ChatAssistantDirectory';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface ChatGroupRuntimeDependencies {
  groups: IGroupChatRepository;
  membership: GroupMembershipRepository;
  captureHistory: ChatSummaryRepository['captureGroupHistoryInTransaction'];
  assistantDirectory: Pick<ChatAssistantDirectory, 'getById' | 'list'>;
  currentUserDirectory: {
    getCurrent(): Promise<{
      id: string;
      name: string;
      avatar: string | null;
      avatarMediaAssetId: string | null;
    }>;
  };
}

const chatGroupRuntimeSlot = createRuntimeSlot<ChatGroupRuntimeDependencies>('Chat group');

export function configureChatGroupRuntime(
  dependencies: ChatGroupRuntimeDependencies,
): void {
  chatGroupRuntimeSlot.configure(dependencies);
}

export function getChatGroupRuntimeDependencies(): ChatGroupRuntimeDependencies {
  return chatGroupRuntimeSlot.get();
}
