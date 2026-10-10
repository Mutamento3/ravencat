/** 摘要只在前台空闲期生成；失败保留原文，稍后或下次消息更新重试。 */
import { InteractionManager } from 'react-native';
import { listChatSummaryConversationIds, processChatSummary, getNextChatSummaryWakeAt, setChatEventBus } from '@features/chat/composition';
let configured = false;
let active = false;
let scheduled: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let running: Promise<void> | null = null;
let controller: AbortController | null = null;
let requested = false;
const retryAfter = new Map<string, number>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export function configureChatSummaryQueue(): void {
  if (configured) return;
  configured = true;
  // 通话结束更新既有记录气泡，走 patched 而不是新增消息事件。
  setChatEventBus({ emit(eventName) {
    if (eventName === 'messagesUpdated' || eventName === 'messagesPatched') requestChatSummaryRun();
  } });
}
export function requestChatSummaryRun(): void {
  if (!configured || !active) return;
  requested = true;
  if (running || scheduled) return;
  scheduled = InteractionManager.runAfterInteractions(() => {
    scheduled = null; requested = false;
    controller = new AbortController();
    const signal = controller.signal;
    running = run(signal).catch((error: unknown) => {
      if (!signal.aborted) console.error('[ChatSummary] 队列查询失败', error);
    }).finally(() => {
      running = null; controller = null;
      if (requested && active) requestChatSummaryRun();
    });
  });
}
async function run(signal: AbortSignal): Promise<void> {
  const ids = await listChatSummaryConversationIds();
  const existing = new Set(ids);
  for (const id of retryAfter.keys()) if (!existing.has(id)) retryAfter.delete(id);
  for (const id of ids) {
    if (signal.aborted) return;
    if ((retryAfter.get(id) ?? 0) > Date.now()) continue;
    try {
      if (await processChatSummary(id, signal)) requested = true;
      retryAfter.delete(id);
    } catch (error) {
      if (signal.aborted) return;
      retryAfter.set(id, Date.now() + 120_000);
      console.warn('[ChatSummary] 摘要未提交，原文继续保留', { conversationId: id }, error);
    }
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const claimWakeAt = await getNextChatSummaryWakeAt();
  if ((retryAfter.size || claimWakeAt !== null) && active) {
    const earliest = Math.min(...retryAfter.values(), claimWakeAt ? Date.parse(claimWakeAt) : Infinity);
    retryTimer = setTimeout(requestChatSummaryRun, Math.max(0, earliest - Date.now()));
  }
}
export function setChatSummaryForegroundActive(value: boolean): void {
  active = value;
  if (active) requestChatSummaryRun();
  else {
    scheduled?.cancel(); scheduled = null; requested = false; controller?.abort();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }
}
export async function stopChatSummaryQueueForReset(): Promise<void> {
  setChatSummaryForegroundActive(false);
  if (running) await running;
  retryAfter.clear();
}
