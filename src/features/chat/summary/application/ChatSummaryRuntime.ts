/** Chat 拥有摘要生命周期；Host 仅提供模型与批次设置查询端口。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ChatSummaryModelInput, ChatSummaryRepository, SecondaryChatSummaryClaim, ChatSummaryCallDiagnostics, ChatSummaryRequestSettings } from '../domain/ChatSummaryRepository';
export interface ChatSummaryRuntime {
  repository: ChatSummaryRepository;
  getBatchSize(conversationId: string): Promise<number | null>;
  /** 模型边界只返回已去除首尾空白的非空、未截断正文；Chat 直接提交，不再解析输出结构。 */
  generateAddition(input: ChatSummaryModelInput, signal: AbortSignal, report: (diagnostics: ChatSummaryCallDiagnostics) => Promise<void>, settings: ChatSummaryRequestSettings): Promise<string>;
  /** 与一级相同的纯正文契约。 */
  generateSecondary(input: SecondaryChatSummaryClaim, signal: AbortSignal, report: (diagnostics: ChatSummaryCallDiagnostics) => Promise<void>, settings: ChatSummaryRequestSettings): Promise<string>;
}
const slot = createRuntimeSlot<ChatSummaryRuntime>('ChatSummary');
export function configureChatSummaryRuntime(runtime: ChatSummaryRuntime): void { slot.configure(runtime); }
export function getChatSummaryRuntime(): ChatSummaryRuntime { return slot.get(); }
const listeners = new Set<(conversationId: string, kind: 'summary' | 'task') => void>();
export function subscribeChatSummaryChanged(listener: (conversationId: string, kind: 'summary' | 'task') => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
/** 任务状态通知供页面刷新；调度只响应摘要事实和用户设置，避免自身状态形成重试循环。 */
export function emitChatSummaryChanged(conversationId: string, kind: 'summary' | 'task' = 'summary'): void {
  for (const listener of listeners) listener(conversationId, kind);
}
