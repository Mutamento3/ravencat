/** 会话列表置顶命令：单聊置顶写 canonical conversation 的 `sessions.is_pinned`。 */
import { getChatConversationRuntimeDependencies } from './ChatConversationRuntime';
import type { ChatSession } from '../domain/SessionRepository';

/**
 * 切换单聊会话置顶。
 *
 * 置顶只决定列表分区与置顶区内的位置：repository 会写
 * `is_pinned = 1` + `pinned_at = 置顶时刻`（取消置顶两者一起归零），
 * 不触碰任何消息事实。
 *
 * 从未打开过的 AI 还没有 canonical 身份行，而「置顶」本身就是用户要把它留在顶部，
 * 所以先幂等地拿到唯一会话身份（已存在时只是一次索引读）。
 */
export async function setDirectConversationPinned(
  aiId: string,
  pinned: boolean,
): Promise<ChatSession> {
  const normalizedAIId = String(aiId || '').trim();
  if (!normalizedAIId) {
    throw new Error('置顶需要有效的 AI 标识');
  }

  const sessions = getChatConversationRuntimeDependencies().sessions;
  const session = await sessions.resolveCanonicalConversation(normalizedAIId);
  // 直接返回落库后重读出来的会话事实，避免在应用层再造一份 pinnedAt。
  const updated = await sessions.setConversationPinned(session.id, pinned);
  if (!updated) {
    throw new Error(`会话不存在，无法切换置顶：${session.id}`);
  }

  return updated;
}
