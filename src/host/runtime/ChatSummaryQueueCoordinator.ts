/** 摘要只在前台空闲期生成；有限重试与冷却由持久化任务拥有。 */
import { InteractionManager } from 'react-native';
import { showAppDialog } from '@shared/ui/appDialogStore';
import { prepareChatSummaryConversations, processChatSummary, getNextChatSummaryWakeAt, setChatEventBus } from '@features/chat/composition';
import { subscribeChatSummaryChanged } from '@features/chat';
import { subscribeAuxiliaryModelsChanged } from '@features/assistants';
let configured = false;
let active = false;
let scheduled: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
let running: Promise<void> | null = null;
let controller: AbortController | null = null;
let scanAll = false;
const requestedConversations = new Set<string>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
export function configureChatSummaryQueue(): void {
  if (configured) return;
  configured = true;
  subscribeChatSummaryChanged((id, kind, detail) => {
    if (kind === 'summary') { requestChatSummaryRun(id); return; }
    // 上下文溢出只能靠换模型或调小整理条数解决，任务彻底失败时主动提醒，避免静默停摆。
    if (detail?.finalFailure?.kind === 'context_overflow') {
      showAppDialog({ title: '摘要整理失败', message: detail.finalFailure.message, tone: 'error' });
    }
  });
  subscribeAuxiliaryModelsChanged(() => requestChatSummaryRun());
  // 通话结束更新既有记录气泡，走 patched 而不是新增消息事件。
  setChatEventBus({ emit(eventName, payload) {
    if (eventName === 'messagesUpdated' || eventName === 'messagesPatched' || eventName === 'groupSpeechPlanChanged') requestChatSummaryRun(payload.sessionId);
  } });
}
export function requestChatSummaryRun(conversationId?: string): void {
  if (!configured || !active) return;
  if (conversationId === undefined) scanAll = true;
  else requestedConversations.add(conversationId);
  schedulePending();
}
function schedulePending(): void {
  if (!active || running || scheduled || (!scanAll && requestedConversations.size === 0)) return;
  scheduled = InteractionManager.runAfterInteractions(() => {
    scheduled = null;
    // 普通事实只使所属会话失效；前台恢复、模型配置和租期唤醒才需要全量发现。
    const conversationIds = scanAll ? undefined : [...requestedConversations];
    scanAll = false;
    requestedConversations.clear();
    controller = new AbortController();
    const signal = controller.signal;
    running = run(signal, conversationIds).catch((error: unknown) => {
      if (!signal.aborted) console.error('[ChatSummary] 队列准备失败', error);
    }).finally(() => {
      running = null; controller = null;
      schedulePending();
    });
  });
}
async function run(signal: AbortSignal, conversationIds?: readonly string[]): Promise<void> {
  const ids = await prepareChatSummaryConversations(conversationIds);
  for (const id of ids) {
    if (signal.aborted) return;
    try {
      if (await processChatSummary(id, signal)) requestChatSummaryRun(id);
    } catch (error) {
      if (signal.aborted) return;
      console.error('[ChatSummary] 摘要维护失败', { conversationId: id }, error);
    }
  }
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const claimWakeAt = await getNextChatSummaryWakeAt();
  if (claimWakeAt !== null && active) {
    retryTimer = setTimeout(() => requestChatSummaryRun(), Math.max(0, Date.parse(claimWakeAt) - Date.now()));
  }
}
export function setChatSummaryForegroundActive(value: boolean): void {
  active = value;
  if (active) requestChatSummaryRun();
  else {
    scheduled?.cancel(); scheduled = null; scanAll = false; requestedConversations.clear(); controller?.abort();
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }
}
export async function stopChatSummaryQueueForReset(): Promise<void> {
  setChatSummaryForegroundActive(false);
  if (running) await running;
}
