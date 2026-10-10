/** 用户可维护已有摘要，自动模型只能消费固定批次并追加。 */
import { randomUUID } from 'expo-crypto';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { emitChatSummaryChanged, getChatSummaryRuntime } from './ChatSummaryRuntime';
import { CHAT_SUMMARY_ADDITION_MAX_CHARACTERS, type ChatSummaryAddition, type ChatSummaryModelInput } from '../domain/ChatSummaryRepository';
import { splitSummaryMessages } from '../domain/ChatSummaryTimeline';

function requireSummaryContent(value: string): string {
  const content = value.trim();
  if (!content) throw new Error('摘要正文不能为空');
  return content;
}
export async function getChatSummaryContext(conversationId: string, protectedMessageIds: readonly number[] = []) {
  return getChatSummaryRuntime().repository.readContext(conversationId, protectedMessageIds);
}
export async function createChatSummary(conversationId: string, content: string) {
  await getChatSummaryRuntime().repository.create(conversationId, randomUUID(), requireSummaryContent(content), new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  emitChatSummaryChanged(conversationId);
}
export async function editChatSummary(conversationId: string, segmentId: string, content: string) {
  await getChatSummaryRuntime().repository.edit(conversationId, segmentId, requireSummaryContent(content), new Date().toISOString());
  emitChatSummaryChanged(conversationId);
}
export async function deleteChatSummary(conversationId: string, segmentId: string) {
  await getChatSummaryRuntime().repository.delete(conversationId, segmentId);
  emitChatSummaryChanged(conversationId);
}
export async function clearChatSummary(conversationId: string) {
  await getChatSummaryRuntime().repository.clear(conversationId);
  emitChatSummaryChanged(conversationId);
}
/** 模型输出是外部边界，不能把整个摘要列表或编辑指令作为追加结果。 */
export function parseChatSummaryAddition(text: string): string {
  const value: unknown = JSON.parse(text.trim());
  if (typeof value !== 'object' || value === null || Array.isArray(value)
    || Object.keys(value).length !== 1 || !('content' in value) || typeof value.content !== 'string') {
    throw new Error('摘要模型必须只返回新增正文 content');
  }
  const content = requireSummaryContent(value.content);
  if (Array.from(content).length > CHAT_SUMMARY_ADDITION_MAX_CHARACTERS) {
    throw new Error(`自动摘要正文不能超过 ${CHAT_SUMMARY_ADDITION_MAX_CHARACTERS} 个字符`);
  }
  return content;
}
export async function processChatSummary(conversationId: string, signal: AbortSignal): Promise<boolean> {
  const runtime = getChatSummaryRuntime();
  const batchSize = await runtime.getBatchSize(conversationId);
  if (batchSize === null) return false;
  throwIfAbortSignalAborted(signal);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 180_000).toISOString();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const claim = await runtime.repository.claim(conversationId, batchSize, randomUUID(), now.toISOString(), expiresAt, timeZone);
  if (!claim) return false;
  try {
    const batches = splitSummaryMessages(claim.messages);
    const additions: ChatSummaryAddition[] = [];
    for (const [index, messages] of batches.entries()) {
      throwIfAbortSignalAborted(signal);
      const started = new Date();
      // 每次请求都有原有的时限；下一分片开始前续租，不能让长通话突破 claim 生命周期。
      if (!await runtime.repository.renewClaim(claim, started.toISOString(), new Date(started.getTime() + 180_000).toISOString())) return false;
      const callIds = new Set(messages.map((message) => message.callId));
      const input: ChatSummaryModelInput = { conversationId, timeZone, previous: claim.previous, messages,
        calls: claim.calls.filter((call) => callIds.has(call.info.callId)), part: { index: index + 1, total: batches.length },
        earlierAdditionsReadOnly: additions.map((addition) => addition.content) };
      const content = parseChatSummaryAddition(await runtime.generateAddition(input, signal));
      additions.push({ id: randomUUID(), content, messages });
    }
    throwIfAbortSignalAborted(signal);
    const appended = await runtime.repository.appendClaim(claim, additions, new Date().toISOString());
    if (appended) emitChatSummaryChanged(conversationId);
    return appended;
  } finally { await runtime.repository.releaseClaim(claim); }
}
export function listChatSummaryConversationIds() { return getChatSummaryRuntime().repository.listConversationIds(); }
export function getNextChatSummaryWakeAt() { return getChatSummaryRuntime().repository.getNextWakeAt(); }
export function buildChatSummaryModelInput(input: ChatSummaryModelInput, currentAgentId?: string): string {
  return JSON.stringify({ sourceKind: 'conversation', currentAgentId, timeZone: input.timeZone, part: input.part,
    calls: input.calls.map((call) => ({ ...call.info, historyStartsAfter: call.historyStartsAfter })),
    earlierAdditionsReadOnly: input.earlierAdditionsReadOnly,
    previousSummariesReadOnly: input.previous.map((segment) => ({
    content: segment.content, discussionStart: segment.sourceStartAt, discussionEnd: segment.sourceEndAt, timeZone: segment.timeZone,
  })), newMessagesOnly: input.messages.map((message) => ({
    timestamp: message.timestamp, localDateTime: new Date(message.timestamp).toLocaleString('sv-SE', { timeZone: input.timeZone }),
    source: message.source, callId: message.callId, speaker: message.speaker, content: message.content,
    continuation: message.continuation,
  })) });
}
