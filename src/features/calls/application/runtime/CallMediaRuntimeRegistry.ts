/** 资源只由 Headless 执行入口创建；UI 卸载不触碰会话所有权。 */
import type { CallMediaRuntime } from './CallMediaRuntime';

let current: { callId: string; runtime: CallMediaRuntime } | null = null;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

export function registerHostedCallMediaRuntime(callId: string, runtime: CallMediaRuntime): void {
  if (current && current.callId === callId) throw new Error(`通话 ${callId} 已有执行任务`);
  current = { callId, runtime };
  runtime.subscribe(publish);
  publish();
}

export const readCallRuntimeView = (callId: string) => current?.callId === callId ? current.runtime.getSnapshot() : null;
export function subscribeCallRuntimeView(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export async function refreshHostedCallMedia(callId: string): Promise<void> {
  if (current?.callId === callId) await current.runtime.getSnapshot().refresh();
}

export function completeHostedCallExecution(callId: string): void {
  if (current?.callId === callId) current.runtime.complete();
}
