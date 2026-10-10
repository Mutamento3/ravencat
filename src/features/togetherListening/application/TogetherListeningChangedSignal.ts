/** Together Listening 真值失效信号；payload 不是状态，订阅方收到后必须重新读取。 */

export type TogetherListeningChangedListener = () => void;

const listeners = new Set<TogetherListeningChangedListener>();

export function emitTogetherListeningChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      // invalidation 是 commit 后提示，订阅方异常不能改写 canonical command 结果。
      console.warn('[TogetherListening] 真值失效订阅方执行失败：', error);
    }
  }
}

export function subscribeTogetherListeningChanged(
  listener: TogetherListeningChangedListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
