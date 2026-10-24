import type { CallEvent } from '../../domain/CallEvent';

const listeners = new Set<(event: CallEvent) => void>();

/** 只发布已经提交的文本、按句播放与错误事实，展示不等待整轮回复结束。 */
export function publishCallTranscriptFact(event: CallEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeCallTranscriptFacts(listener: (event: CallEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
