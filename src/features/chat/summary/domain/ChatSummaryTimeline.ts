/** 摘要与模型历史共用一条时间线；Chat 保留 canonical 分组，Calls 保留事实来源。 */
import type { CallSummarySource } from '@features/calls';
import type { ChatContextItem } from './ChatContext';
import type { SharedChatRecord } from '../../messages/domain/SharedChatRecord';
import { CHAT_SUMMARY_INPUT_MAX_CHARACTERS } from './ChatSummaryRepository';

export interface ConversationContextItem {
  source: 'chat' | 'call';
  kind: 'dialogue' | 'app_event';
  speaker: 'user' | 'assistant' | 'application';
  timestamp: string;
  content: string;
  actor?: ChatContextItem['actor'];
  sharedRecord?: SharedChatRecord;
  sharedComment?: string;
  logicalIdentity: string | null;
  messageId?: number;
  eventId?: string;
  callId?: string;
  callBoundary?: 'start' | 'end';
  /** 单条超长原文分片仍属于同一消息，只在摘要任务输入标明续段。 */
  continuation?: { index: number; total: number };
}

export function buildConversationTimeline(raw: readonly ChatContextItem[], calls: readonly CallSummarySource[]): ConversationContextItem[] {
  const entries: { item: ConversationContextItem; orderAt: string; rank: number; identity: string }[] = [];
  for (const call of calls) {
    const info = call.info;
    const startedAt = info.acceptedAt ?? info.startedAt;
    const after = call.historyStartsAfter;
    if (after === null || startedAt > after) entries.push({ orderAt: startedAt, rank: 0, identity: info.callId, item: {
      source: 'call', kind: 'app_event', speaker: 'application', timestamp: startedAt, callId: info.callId,
      callBoundary: 'start', logicalIdentity: null,
      content: '[通话开始，历史资料] ' + JSON.stringify({ callId: info.callId, mediaMode: info.mediaMode,
        direction: info.direction, startedAt, accepted: info.acceptedAt !== null }),
    } });
    for (const transcript of call.transcripts) entries.push({ orderAt: transcript.timestamp, rank: 1, identity: transcript.eventId, item: {
      source: 'call', kind: transcript.speaker === 'application' ? 'app_event' : 'dialogue',
      speaker: transcript.speaker, timestamp: transcript.timestamp, content: transcript.content,
      callId: info.callId, eventId: transcript.eventId,
      logicalIdentity: transcript.speaker === 'application' ? null : 'call:' + transcript.eventId,
    } });
    if (info.endedAt !== null) entries.push({ orderAt: info.endedAt, rank: 2, identity: info.callId, item: {
      source: 'call', kind: 'app_event', speaker: 'application', timestamp: info.endedAt, callId: info.callId,
      callBoundary: 'end', logicalIdentity: null, content: '[通话结束，历史资料] ' + JSON.stringify(info),
    } });
  }
  entries.sort((left, right) => left.orderAt.localeCompare(right.orderAt) || left.rank - right.rank || left.identity.localeCompare(right.identity));
  const timeline: ConversationContextItem[] = [];
  let callIndex = 0;
  for (const item of raw) {
    while (callIndex < entries.length && entries[callIndex].orderAt <= item.cursor[0]) timeline.push(entries[callIndex++].item);
    timeline.push({ source: 'chat', kind: item.kind, speaker: item.kind === 'app_event' ? 'application' : item.role,
      timestamp: item.timestamp, content: item.content, messageId: item.messageId,
      ...(item.actor ? { actor: item.actor } : {}),
      ...(item.sharedRecord ? { sharedRecord: item.sharedRecord, sharedComment: item.sharedComment } : {}),
      logicalIdentity: item.kind === 'dialogue'
        ? item.logicalMessageId === null ? 'chat:message:' + item.messageId : 'chat:logical:' + item.logicalMessageId : null });
  }
  while (callIndex < entries.length) timeline.push(entries[callIndex++].item);
  return timeline;
}

export function conversationDialogueStartIndexes(items: readonly ConversationContextItem[]): number[] {
  const seen = new Set<string>();
  const starts: number[] = [];
  items.forEach((item, index) => {
    if (item.logicalIdentity === null || seen.has(item.logicalIdentity)) return;
    seen.add(item.logicalIdentity); starts.push(index);
  });
  return starts;
}

/** N 是触发门槛；跨入电话后范围延伸到挂断，不留下半通电话等待下一次凑数。 */
export function selectSummaryRange(items: readonly ConversationContextItem[], batchSize: number): ConversationContextItem[] {
  const starts = conversationDialogueStartIndexes(items);
  if (starts.length < batchSize) return [];
  let end = starts[batchSize] ?? items.length;
  // 额度已在通话前满足时，不把紧接着的下一通电话起点误归入上一批。
  const nextCall = items.findIndex((item, index) => index > starts[batchSize - 1] && item.callBoundary === 'start');
  if (nextCall >= 0) end = Math.min(end, nextCall);
  const callEnds = new Map<string, number>();
  items.forEach((item, index) => { if (item.callBoundary === 'end') callEnds.set(item.callId!, index); });
  for (let index = 0; index < end; index++) {
    const callId = items[index].callId;
    if (callId === undefined) continue;
    const endedIndex = callEnds.get(callId);
    if (endedIndex === undefined) return [];
    end = Math.max(end, endedIndex + 1);
  }
  return items.slice(0, end);
}

/** 5000 字只约束本次新原文；优先完整消息，单条超限才按 Unicode 码点拆开。 */
export function splitSummaryMessages(items: readonly ConversationContextItem[]): ConversationContextItem[][] {
  const batches: ConversationContextItem[][] = [];
  let batch: ConversationContextItem[] = [];
  let length = 0;
  for (const item of items) {
    const characters = Array.from(item.content);
    const total = Math.ceil(characters.length / CHAT_SUMMARY_INPUT_MAX_CHARACTERS);
    for (let index = 0; index < total; index++) {
      const part = characters.slice(index * CHAT_SUMMARY_INPUT_MAX_CHARACTERS, (index + 1) * CHAT_SUMMARY_INPUT_MAX_CHARACTERS).join('');
      const partLength = Array.from(part).length;
      if (length + partLength > CHAT_SUMMARY_INPUT_MAX_CHARACTERS && batch.length) {
        batches.push(batch); batch = []; length = 0;
      }
      batch.push(total === 1 ? item : { ...item, content: part, continuation: { index: index + 1, total } });
      length += partLength;
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}
