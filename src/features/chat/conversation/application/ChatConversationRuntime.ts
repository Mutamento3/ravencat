/** 会话应用运行时依赖：由 Chat composition 注入仓储与数据库维护能力。 */

import type { ISessionRepository } from '../domain/SessionRepository';
import type { ChatAssistantDirectory } from '../../ChatAssistantDirectory';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface ChatConversationRuntimeDependencies {
  sessions: ISessionRepository;
  assistantDirectory: Pick<ChatAssistantDirectory, 'list'>;
  database: {
    clear: () => Promise<boolean>;
    getInfo: () => Promise<unknown>;
  };
}

const chatConversationRuntimeSlot = createRuntimeSlot<ChatConversationRuntimeDependencies>(
  'Chat conversation',
);

export function configureChatConversationRuntime(
  dependencies: ChatConversationRuntimeDependencies,
): void {
  chatConversationRuntimeSlot.configure(dependencies);
}

export function getChatConversationRuntimeDependencies(): ChatConversationRuntimeDependencies {
  return chatConversationRuntimeSlot.get();
}
