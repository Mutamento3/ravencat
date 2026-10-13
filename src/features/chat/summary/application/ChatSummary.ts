/** 用户可维护已有摘要，自动模型只能消费固定批次并追加。 */
import { randomUUID } from 'expo-crypto';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { emitChatSummaryChanged, getChatSummaryRuntime } from './ChatSummaryRuntime';
import { ChatSummaryGenerationError, type ChatSummaryTaskClaim, type ChatSummaryAddition, type ChatSummaryModelInput, type ChatSummarySettingsPatch, type ChatSummarySearchInput, type ChatSummarySegment , ChatBackgroundContextOptions } from '../domain/ChatSummaryRepository';
import { splitSummaryMessages } from '../domain/ChatSummaryTimeline';
import { buildSharedChatRecordText } from '../../messages/domain/SharedChatRecord';
import type { DatabaseTransactionExecutor } from '@platform/persistence';

/** Host在资产变更事务中调用；正文、进度和配置引用保持不变。 */
export function invalidateChatSummaryModelReferencesInTransaction(transaction: DatabaseTransactionExecutor, modelConfigId: string): Promise<void> {
  return getChatSummaryRuntime().repository.invalidateModelReferencesInTransaction(transaction, modelConfigId);
}

function requireSummaryContent(value: string): string {
  const content = value.trim();
  if (!content) throw new Error('摘要正文不能为空');
  return content;
}
export async function getChatSummaryContext(conversationId: string, protectedMessageIds: readonly number[] = []) {
  return getChatSummaryRuntime().repository.readContext(conversationId, protectedMessageIds);
}
export function getChatBackgroundContexts(assistantId: string, currentConversationId: string, options: ChatBackgroundContextOptions) {
  return getChatSummaryRuntime().repository.readBackgroundContexts(assistantId, currentConversationId, options);
}
export async function createChatSummary(conversationId: string, content: string) {
  await getChatSummaryRuntime().repository.create(conversationId, randomUUID(), requireSummaryContent(content), new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  emitChatSummaryChanged(conversationId);
}
export async function editChatSummary(conversationId: string, segmentId: string, content: string) {
  await getChatSummaryRuntime().repository.edit(conversationId, segmentId, requireSummaryContent(content), new Date().toISOString());
  emitChatSummaryChanged(conversationId);
}
export async function editCombinedSecondarySummary(conversationId: string, expected: readonly ChatSummarySegment[], content: string) {
  await getChatSummaryRuntime().repository.replaceSecondary(conversationId, expected, requireSummaryContent(content), new Date().toISOString());
  emitChatSummaryChanged(conversationId);
}
export async function deleteCombinedSecondarySummary(conversationId: string, expected: readonly ChatSummarySegment[]) {
  await getChatSummaryRuntime().repository.replaceSecondary(conversationId, expected, null, new Date().toISOString());
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
export class ChatSummaryInputError extends Error {}
/** 阈值在页面草稿边界验证；内部命令信任合法字段，独立增量由 Repository 原子合并。 */
export async function updateChatSummarySettings(conversationId: string, patch: ChatSummarySettingsPatch) {
  await getChatSummaryRuntime().repository.updateSettings(conversationId, patch);
  emitChatSummaryChanged(conversationId);
}
export function getChatSummarySettings(conversationId: string) {
  return getChatSummaryRuntime().repository.readSettings(conversationId);
}
export async function setFixedChatContextStart(conversationId: string, messageId: number | null) {
  await getChatSummaryRuntime().repository.setFixedStart(conversationId, messageId);
  emitChatSummaryChanged(conversationId);
}
export async function retryChatSummaryTask(conversationId: string, taskId: string) {
  await getChatSummaryRuntime().repository.retryTask(conversationId, taskId, new Date().toISOString());
  emitChatSummaryChanged(conversationId);
}
async function recordFailure(claim: ChatSummaryTaskClaim, error: unknown, signal: AbortSignal) {
  if (signal.aborted) return false;
  if (!(error instanceof ChatSummaryGenerationError)) throw error;
  const failure = error.failure;
  const changed = await getChatSummaryRuntime().repository.failTask(claim, failure, new Date().toISOString());
  if (changed) emitChatSummaryChanged(claim.conversationId, 'task');
  return false;
}
export async function searchChatSummaries(assistantId: string, input: ChatSummarySearchInput) {
  const normalizeDate = (value: string | undefined): string | undefined => {
    if (value === undefined) return undefined;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new ChatSummaryInputError('摘要查询时间无效，请提供 ISO 8601 时间');
    return new Date(time).toISOString();
  };
  const from = normalizeDate(input.from), to = normalizeDate(input.to);
  if (from !== undefined && to !== undefined && from > to) throw new ChatSummaryInputError('查询开始时间不能晚于结束时间');
  return getChatSummaryRuntime().repository.search(assistantId, { ...input, from, to });
}
export async function processChatSummary(conversationId: string, signal: AbortSignal): Promise<boolean> {
  const runtime = getChatSummaryRuntime();
  const batchSize = await runtime.getBatchSize(conversationId);
  if (batchSize === null) return false;
  // 已有一级达到新阈值时先处理二级；某一层失败不阻止另一层读取自己的可处理范围。
  const existingSecondary = await processSecondaryChatSummary(conversationId, signal);
  if (signal.aborted) return false;
  if (existingSecondary) return true;
  const primary = await processPrimaryChatSummary(conversationId, batchSize, signal);
  const secondary = primary ? await processSecondaryChatSummary(conversationId, signal) : false;
  return primary || secondary;
}
async function processPrimaryChatSummary(conversationId: string, batchSize: number, signal: AbortSignal): Promise<boolean> {
  const runtime = getChatSummaryRuntime();
  throwIfAbortSignalAborted(signal);
  const now = new Date();
  const initialSettings = await runtime.repository.readSettings(conversationId);
  const initialLeaseMs = initialSettings.requestTimeoutSeconds * 1000 + 60_000;
  const expiresAt = new Date(now.getTime() + initialLeaseMs).toISOString();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const claim = await runtime.repository.claim(conversationId, batchSize, randomUUID(), now.toISOString(), expiresAt, timeZone);
  if (!claim) return false;
  // 请求选择与generation必须来自领取事务的同一快照，不能沿用领取前的旧设置。
  const settings = claim.requestSettings;
  const leaseMs = settings.requestTimeoutSeconds * 1000 + 60_000;
  emitChatSummaryChanged(conversationId, 'task');
  try {
    const batches = splitSummaryMessages(claim.messages);
    const additions: ChatSummaryAddition[] = [];
    for (const [index, messages] of batches.entries()) {
      throwIfAbortSignalAborted(signal);
      const started = new Date();
      // 每次请求都有原有的时限；下一分片开始前续租，不能让长通话突破 claim 生命周期。
      if (!await runtime.repository.renewClaim(claim, started.toISOString(), new Date(started.getTime() + leaseMs).toISOString())) return false;
      const callIds = new Set(messages.map((message) => message.callId));
      const input: ChatSummaryModelInput = { conversationId, timeZone, previous: claim.previous, messages,
        calls: claim.calls.filter((call) => callIds.has(call.info.callId)), part: { index: index + 1, total: batches.length },
        earlierAdditionsReadOnly: additions.map((addition) => addition.content) };
      const content = await runtime.generateAddition(input, signal,
        (diagnostics) => runtime.repository.recordInvocation(claim, diagnostics, new Date().toISOString()), settings);
      additions.push({ id: randomUUID(), content, messages });
    }
    throwIfAbortSignalAborted(signal);
    const appended = await runtime.repository.appendClaim(claim, additions, new Date().toISOString());
    if (appended) emitChatSummaryChanged(conversationId);
    return appended;
  } catch (error) { return await recordFailure(claim, error, signal); }
  finally { await runtime.repository.releaseClaim(claim); emitChatSummaryChanged(conversationId, 'task'); }
}
async function processSecondaryChatSummary(conversationId: string, signal: AbortSignal): Promise<boolean> {
  const runtime = getChatSummaryRuntime();
  throwIfAbortSignalAborted(signal);
  const now = new Date();
  const settings = await runtime.repository.readSettings(conversationId);
  const claim = await runtime.repository.claimSecondary(conversationId, randomUUID(), now.toISOString(),
    new Date(now.getTime() + settings.requestTimeoutSeconds * 1000 + 60_000).toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  if (!claim) return false;
  emitChatSummaryChanged(conversationId, 'task');
  try {
    const request = claim.requestSettings;
    const started = new Date();
    if (!await runtime.repository.renewClaim(claim, started.toISOString(), new Date(started.getTime() + request.requestTimeoutSeconds * 1000 + 60_000).toISOString())) return false;
    const content = await runtime.generateSecondary(claim, signal,
      (diagnostics) => runtime.repository.recordInvocation(claim, diagnostics, new Date().toISOString()), request);
    throwIfAbortSignalAborted(signal);
    const committed = await runtime.repository.appendSecondary(claim, randomUUID(), content, new Date().toISOString());
    if (committed) emitChatSummaryChanged(conversationId);
    return committed;
  } catch (error) { return await recordFailure(claim, error, signal); }
  finally { await runtime.repository.releaseSecondaryClaim(claim); emitChatSummaryChanged(conversationId, 'task'); }
}
export async function prepareChatSummaryConversations() {
  const { conversationIds, pausedConversationIds } = await getChatSummaryRuntime().repository.prepareConversations(new Date().toISOString());
  for (const id of pausedConversationIds) emitChatSummaryChanged(id, 'task');
  return conversationIds;
}
export function getNextChatSummaryWakeAt() { return getChatSummaryRuntime().repository.getNextWakeAt(); }
export function buildChatSummaryModelInput(input: ChatSummaryModelInput, currentAgentId?: string): string {
  return JSON.stringify({ sourceKind: 'conversation', currentAgentId, timeZone: input.timeZone, part: input.part,
    calls: input.calls.map((call) => ({ ...call.info, historyStartsAfter: call.historyStartsAfter })),
    earlierAdditionsReadOnly: input.earlierAdditionsReadOnly,
    previousSummariesReadOnly: input.previous.map((segment) => ({
    content: segment.content, discussionStart: segment.sourceStartAt, discussionEnd: segment.sourceEndAt, timeZone: segment.timeZone,
  })), newMessagesOnly: input.messages.map((message) => ({
    timestamp: message.timestamp, localDateTime: new Date(message.timestamp).toLocaleString('sv-SE', { timeZone: input.timeZone }),
    source: message.source, callId: message.callId, speaker: message.speaker,
    content: message.sharedRecord ? buildSharedChatRecordText(message.sharedRecord, message.sharedComment!, currentAgentId) : message.content,
    ...(message.actor ? { actor: message.actor } : {}),
    continuation: message.continuation,
  })) });
}
