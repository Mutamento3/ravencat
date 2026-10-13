/** 摘要只在前台空闲期生成；有限重试与冷却由持久化任务拥有。 */
import { InteractionManager } from 'react-native';
import { prepareChatSummaryConversations, processChatSummary, getNextChatSummaryWakeAt, setChatEventBus } from '@features/chat/composition';
import { subscribeChatSummaryChanged } from '@features/chat';
import { subscribeAuxiliaryModelsChanged } from '@features/assistants';
let configured = false;
let active = false;
let scheduled: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let running: Promise<void> | null = null;
let controller: AbortController | null = null;
let requested = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export function configureChatSummaryQueue(): void {
  if (configured) return;
  configured = true;
  subscribeChatSummaryChanged((_id, kind) => { if (kind === 'summary') requestChatSummaryRun(); });
  subscribeAuxiliaryModelsChanged(requestChatSummaryRun);
  // 通话结束更新既有记录气泡，走 patched 而不是新增消息事件。
  setChatEventBus({ emit(eventName) {
    if (eventName === 'messagesUpdated' || eventName === 'messagesPatched' || eventName === 'groupSpeechPlanChanged') requestChatSummaryRun();
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
      if (!signal.aborted) console.error('[ChatSummary] 队列准备失败', error);
    }).finally(() => {
      running = null; controller = null;
      if (requested && active) requestChatSummaryRun();
    });
  });
}
async function run(signal: AbortSignal): Promise<void> {
  const ids = await prepareChatSummaryConversations();
  for (const id of ids) {
    if (signal.aborted) return;
    try {
      if (await processChatSummary(id, signal)) requested = true;
    } catch (error) {
      if (signal.aborted) return;
      console.error('[ChatSummary] 摘要维护失败', { conversationId: id }, error);
    }
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const claimWakeAt = await getNextChatSummaryWakeAt();
  if (claimWakeAt !== null && active) {
    retryTimer = setTimeout(requestChatSummaryRun, Math.max(0, Date.parse(claimWakeAt) - Date.now()));
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
}
