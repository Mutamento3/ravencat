/** Chat 拥有的 stateful timeline entry 基础命令：原子 upsert 后发布对应 UI 信号。 */

import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import {
  emitChatMessagesPatched,
  emitChatMessagesUpdated,
} from '../events/ChatEvents';
import type { ChatMessage, CreateMessageInput } from '../domain/ChatMessage';
import type {
  IMessageRepository,
  UpsertStatefulTimelineEntryInput,
  UpsertStatefulTimelineEntryResult as RepositoryUpsertStatefulTimelineEntryResult,
} from '../domain/MessageRepository';

export interface UpsertStatefulTimelineEntryParams {
  message: CreateMessageInput;
  previewText: string;
}

export interface UpsertStatefulTimelineEntryResult {
  message: ChatMessage;
  inserted: boolean;
}

export async function upsertStatefulTimelineEntry(
  params: UpsertStatefulTimelineEntryParams,
): Promise<UpsertStatefulTimelineEntryResult> {
  const repository: IMessageRepository = getChatMessageRuntimeDependencies().messages;
  const input: UpsertStatefulTimelineEntryInput = {
    message: params.message,
    previewText: params.previewText,
  };
  const committed: RepositoryUpsertStatefulTimelineEntryResult =
    await repository.upsertStatefulTimelineEntry(input);

  if (committed.inserted) {
    emitChatMessagesUpdated(params.message.sessionId);
  } else {
    emitChatMessagesPatched({
      sessionId: params.message.sessionId,
      updatedMessageIds: [committed.message.id],
    });
  }

  return committed;
}
