/**
 * Embedding 队列的轻量唤醒信号，与标注 pending 信号同构。
 * 只通知“可能存在待建向量”，不承载任务数据；Host worker 收到信号后
 * 仍按批次查询真正需要建索引的 Sticker，embedding 失败不改变 Sticker ready 状态。
 */

export type StickerEmbeddingPendingListener = () => void;

const listeners = new Set<StickerEmbeddingPendingListener>();

export function subscribeStickerEmbeddingPending(
  listener: StickerEmbeddingPendingListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitStickerEmbeddingPending(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.warn('[Sticker] 向量索引唤醒订阅方执行失败：', error);
    }
  }
}
