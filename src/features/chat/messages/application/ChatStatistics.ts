import { getChatMessageRuntimeDependencies } from './ChatMessageRuntime';
import { buildChatStatistics, type ChatStatistics } from '../domain/ChatRecordStatistics';

/** AIProfile 的创建时间由 Assistants owner 保证；聊天查询不再重复读取或推测它。 */
export async function getChatStatistics(sessionId: string, assistantCreatedAt: string): Promise<ChatStatistics> {
  const records = await getChatMessageRuntimeDependencies().messages.getChatRecordStatistics(sessionId);
  return buildChatStatistics(records, assistantCreatedAt);
}
