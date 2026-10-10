/** 聊天功能对外公开的会话生命周期事件。 */

export interface PublicChatSessionDeleted {
  sessionId: string;
  assistantId: string;
}

const sessionDeletedSubscribers = new Set<(
  event: PublicChatSessionDeleted
) => void | Promise<void>>();

export function subscribeToPublicChatSessionDeleted(
  subscriber: (event: PublicChatSessionDeleted) => void | Promise<void>
): () => void {
  sessionDeletedSubscribers.add(subscriber);
  return () => sessionDeletedSubscribers.delete(subscriber);
}

export async function publishPublicChatSessionDeleted(
  event: PublicChatSessionDeleted
): Promise<void> {
  await Promise.all(Array.from(sessionDeletedSubscribers, async (subscriber) => {
    try {
      await subscriber(event);
    } catch (error) {
      console.warn('[ChatPublicEvents] 会话删除订阅者执行失败：', error);
    }
  }));
}
