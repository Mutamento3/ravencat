/** Chat 拥有摘要生命周期；Host 仅提供模型与批次设置查询端口。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ChatSummaryModelInput, ChatSummaryRepository } from '../domain/ChatSummaryRepository';
export interface ChatSummaryRuntime {
  repository: ChatSummaryRepository;
  getBatchSize(conversationId: string): Promise<number | null>;
  generateAddition(input: ChatSummaryModelInput, signal: AbortSignal): Promise<string>;
}
const slot = createRuntimeSlot<ChatSummaryRuntime>('ChatSummary');
export function configureChatSummaryRuntime(runtime: ChatSummaryRuntime): void { slot.configure(runtime); }
export function getChatSummaryRuntime(): ChatSummaryRuntime { return slot.get(); }
const listeners = new Set<(conversationId: string) => void>();
export function subscribeChatSummaryChanged(listener: (conversationId: string) => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function emitChatSummaryChanged(conversationId: string): void { for (const listener of listeners) listener(conversationId); }
