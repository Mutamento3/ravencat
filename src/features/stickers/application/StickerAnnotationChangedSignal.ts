/** Sticker 标注状态提交后的进程内通知；UI 只据此重新查询持久事实。 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function subscribeStickerAnnotationChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitStickerAnnotationChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      // 标注事务已经提交，展示层刷新失败不能改写业务事实。
      console.warn('[Sticker] 标注状态订阅方执行失败：', error);
    }
  }
}
