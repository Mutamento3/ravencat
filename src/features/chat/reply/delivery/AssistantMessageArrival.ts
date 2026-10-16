/** 分段到达的展示投影；数据库事实完整保留，跨 runtime 的进度由宿主原生端口提供。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { AIMessageObserverPayload } from './AIMessageEvents';
import type { ChatMessage } from '../../messages/domain/ChatMessage';

export interface AssistantMessageArrivalSnapshot {
  revision: number;
  pendingMessageIds: readonly number[];
  pendingSessionIds: readonly string[];
}

export interface AssistantMessageArrivalBatch {
  observer: AIMessageObserverPayload;
  messageIds: number[];
}

const runtime = createRuntimeSlot<{
  begin(batch: AssistantMessageArrivalBatch): Promise<AssistantMessageArrivalSnapshot>;
  finish(messageIds: number[]): Promise<AssistantMessageArrivalSnapshot>;
}>('Assistant message arrival');

let snapshot: AssistantMessageArrivalSnapshot = { revision: -1, pendingMessageIds: [], pendingSessionIds: [] };
const listeners = new Set<() => void>();

export const getAssistantMessageArrivalSnapshot = () => snapshot;

export function subscribeAssistantMessageArrival(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function configureAssistantMessageArrivalRuntime(dependencies: Parameters<typeof runtime.configure>[0]): void {
  runtime.configure(dependencies);
}

export function applyAssistantMessageArrivalSnapshot(next: AssistantMessageArrivalSnapshot): void {
  // 原生事件与异步快照可能交错；旧快照不得把已到达的消息重新隐藏。
  if (next.revision <= snapshot.revision) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export async function beginAssistantMessageArrival(batch: AssistantMessageArrivalBatch): Promise<void> {
  applyAssistantMessageArrivalSnapshot(await runtime.get().begin(batch));
}

export async function finishAssistantMessageArrival(messageIds: number[]): Promise<void> {
  // 交付异常不能留下永久隐藏的已提交事实；这里只结束展示投影，不重试交付。
  applyAssistantMessageArrivalSnapshot(await runtime.get().finish(messageIds));
}

export function projectArrivedAssistantMessages(
  messages: readonly ChatMessage[],
  pendingMessageIds: readonly number[],
): ChatMessage[] {
  const pending = new Set(pendingMessageIds);
  return messages.filter(message => !pending.has(message.id));
}
