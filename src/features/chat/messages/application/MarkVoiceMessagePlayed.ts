/** 在原生播放器确认 started 后，幂等记录 assistant 语音首次播放时间。 */
import { emitChatMessagesPatched } from '../events/ChatEvents';
import { getMessageVoice } from '../domain/chatMessageMetadata';
import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';

export async function markVoiceMessagePlayed(messageId: number): Promise<boolean> {
  const repository = getChatMessageRuntimeDependencies().messages;
  const message = await repository.getMessageById(messageId);
  if (!message) {
    throw new Error(`语音消息不存在：${messageId}`);
  }
  if (message.isMe || message.senderType !== 'assistant' || !getMessageVoice(message)) {
    throw new Error(`只有已提交的 assistant 语音消息可以标记播放：${messageId}`);
  }
  if (message.voicePlayedAt) {
    return false;
  }

  const changed = await repository.markVoiceMessagePlayed(messageId, new Date().toISOString());
  if (changed) {
    emitChatMessagesPatched({
      sessionId: message.sessionId,
      updatedMessageIds: [messageId],
    });
  }
  return changed;
}
