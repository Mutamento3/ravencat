/** 封装聊天消息的原子提交与会话预览同步。 */
import type {
  ChatMessage,
  CreateMessageInput,
} from '../domain/ChatMessage';
import type { IMessageRepository } from '../domain/MessageRepository';

export interface PersistChatMessageParams {
  repository: IMessageRepository;
  message: CreateMessageInput;
  previewText?: string | null;
  notifyUI?: (sessionId: string) => void;
}

export interface PersistChatMessagesParams {
  repository: IMessageRepository;
  messages: CreateMessageInput[];
  previewText?: string | null;
  notifyUI?: (sessionId: string) => void;
}

export interface SyncChatSessionPreviewParams {
  repository: IMessageRepository;
  sessionId: string;
  time: string;
  previewText?: string | null;
  committedMessageId?: number;
  notifyUI?: (sessionId: string) => void;
}

export async function syncChatSessionPreview(
  params: SyncChatSessionPreviewParams
): Promise<void> {
  const { repository, sessionId, time, previewText, committedMessageId, notifyUI } = params;

  if (previewText !== undefined && previewText !== null) {
    if (committedMessageId) {
      await repository.updateSessionPreviewForCommittedMessage({
        sessionId,
        messageId: committedMessageId,
        previewText,
      });
    } else {
      await repository.updateSessionPreview(sessionId, previewText, time);
    }
  }

  notifyUI?.(sessionId);
}

export async function persistChatMessage(
  params: PersistChatMessageParams
): Promise<ChatMessage> {
  const { repository, message, previewText, notifyUI } = params;

  // 统一消息提交协议：latest message 读取、时间分隔计算、消息插入、完整 row 查询
  // 与 session preview 更新都在 commitMessage 的同一事务内完成。
  const finalPreviewText = previewText ?? message.text;
  const insertedMessage = await repository.commitMessage({
    message,
    previewText: finalPreviewText,
  });

  // commit 后更新 UI。
  notifyUI?.(message.sessionId);

  return insertedMessage;
}

export async function persistChatMessages(
  params: PersistChatMessagesParams
): Promise<ChatMessage[]> {
  const { repository, messages, previewText, notifyUI } = params;
  if (messages.length === 0) {
    return [];
  }

  const sessionId = messages[0].sessionId;

  // 统一批量消息提交：latest message 读取、逐条时间分隔计算、全部消息插入
  // 与单次 session preview 更新都在 commitMessages 的同一事务内完成。
  const finalPreviewText = previewText ?? messages[messages.length - 1].text;
  const insertedMessages = await repository.commitMessages({
    messages,
    previewText: finalPreviewText,
  });

  // commit 后更新 UI。
  notifyUI?.(sessionId);

  return insertedMessages;
}
