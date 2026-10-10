/** 提交后的刷新／任务唤醒信号不承载持久化事实。 */
const listeners = new Set<() => void>();
export function subscribeMemoryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function emitMemoryChanged(): void { for (const listener of listeners) listener(); }
