/** 归一 React Native 与标准运行时的 AbortSignal 取消检查能力。 */
export function throwIfAbortSignalAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;

  const reason = 'reason' in signal ? signal.reason : undefined;
  throw reason instanceof Error ? reason : new Error('Operation aborted');
}
