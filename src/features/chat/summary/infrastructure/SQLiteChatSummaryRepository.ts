/** 摘要与进度同事务交接；消息删除没有摘要副作用，清摘要独立递增 generation。 */
import { databaseCoordinator, type DatabaseReadExecutor, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { ChatMessage } from '../../messages/domain/ChatMessage';
import { timelineOrderedMessagesCte, timelineProjectionOrderBy, timelineCursorCondition } from '../../messages/infrastructure/ChatTimelineSql';
import { parseChatContextCursor, projectChatContextMessage, type ChatCanonicalCursor, type ChatContextItem } from '../domain/ChatContext';
import type { ChatSummaryAddition, ChatSummaryCallBoundary, ChatSummaryClaim, ChatSummaryRepository, ChatSummarySegment } from '../domain/ChatSummaryRepository';
import type { CallSummarySource } from '@features/calls';
import { buildConversationTimeline, selectSummaryRange, type ConversationContextItem } from '../domain/ChatSummaryTimeline';

interface CallSourceReader {
  (db: DatabaseReadExecutor, conversationId: string, boundary: ChatSummaryCallBoundary): Promise<CallSummarySource[]>;
}

interface StateRow {
  generation: number; revision: number; processed_cursor: string | null;
  claim_id: string | null; claim_expires_at: string | null;
}
interface SegmentRow {
  id: string; conversation_id: string; sequence: number; content: string;
  message_count: number; batch_size: number | null; source_start_at: string | null; source_end_at: string | null;
  time_zone: string; created_at: string; updated_at: string;
}
interface ContextRow {
  id: number; session_id: string; text: string; is_me: number; sender_type: ChatMessage['senderType'];
  status: ChatMessage['status']; delivery_status: ChatMessage['deliveryStatus']; created_at: string; time: string;
  metadata_json: string | null; reply_to_text: string | null; logical_message_id: string | null;
  timeline_order_created_at: string; timeline_order_anchor_id: number; timeline_order_item_index: number;
  agent_activity_pending: number;
}
function executor(name: string) {
  return databaseCoordinator.openTaskExecutor({ name: 'chat.summary.' + name, feature: 'chat', priority: 'maintenance' });
}
async function readState(db: DatabaseTransactionExecutor, conversationId: string): Promise<StateRow> {
  await db.runAsync('INSERT OR IGNORE INTO chat_summary_state (conversation_id) VALUES (?)', [conversationId]);
  return (await db.getFirstAsync<StateRow>('SELECT * FROM chat_summary_state WHERE conversation_id = ?', [conversationId]))!;
}
async function readSegments(db: DatabaseReadExecutor, conversationId: string): Promise<ChatSummarySegment[]> {
  const rows = await db.getAllAsync<SegmentRow>('SELECT * FROM chat_summary_segments WHERE conversation_id = ? ORDER BY sequence', [conversationId]);
  return rows.map((row) => ({ id: row.id, conversationId: row.conversation_id, sequence: row.sequence, content: row.content,
    messageCount: row.message_count, batchSize: row.batch_size, sourceStartAt: row.source_start_at,
    sourceEndAt: row.source_end_at, timeZone: row.time_zone, createdAt: row.created_at, updatedAt: row.updated_at }));
}
async function readCallBoundary(db: DatabaseReadExecutor, conversationId: string): Promise<ChatSummaryCallBoundary> {
  const processed = await db.getAllAsync<{ call_id: string }>('SELECT call_id FROM chat_summary_processed_calls WHERE conversation_id = ?', [conversationId]);
  const boundary = await db.getFirstAsync<{ history_starts_after: string | null }>(`SELECT
    NULLIF(MAX(COALESCE(s.visible_after_at, ''), COALESCE(b.cleared_at, '')), '') AS history_starts_after
    FROM sessions s LEFT JOIN chat_summary_call_boundary b ON b.conversation_id = s.id WHERE s.id = ?`, [conversationId]);
  return { processedCallIds: processed.map((row) => row.call_id), historyStartsAfter: boundary?.history_starts_after ?? null };
}
function claimKey(claim: ChatSummaryClaim): string {
  return JSON.stringify({ toCursor: claim.toCursor, callIds: claim.calls.map((call) => call.info.callId) });
}
async function readItems(
  db: DatabaseReadExecutor,
  conversationId: string,
  { visibleOnly = true, after = null }: { visibleOnly?: boolean; after?: ChatCanonicalCursor | null } = {},
): Promise<ChatContextItem[]> {
  const condition = after ? timelineCursorCondition('ASC', {
    timeline_order_created_at: after[0], timeline_order_anchor_id: after[1],
    timeline_order_item_index: after[2], id: after[3],
  }) : null;
  // 已处理历史在 SQL 边界排除，避免每次 claim 都在独占事务中解析、排序并传回整段历史。
  const rows = await db.getAllAsync<ContextRow>(`${timelineOrderedMessagesCte(`m.session_id = ?
    ${visibleOnly ? 'AND m.id > COALESCE((SELECT visible_after_message_id FROM sessions WHERE id = m.session_id), 0)' : ''}`)}
    SELECT o.*, EXISTS (
      SELECT 1 FROM messages s WHERE s.session_id = o.session_id AND s.turn_run_id = o.turn_run_id
        AND json_valid(s.metadata_json) AND json_extract(s.metadata_json, '$.type') = 'agentActivity'
        AND json_extract(s.metadata_json, '$.phase') = 'started'
        AND NOT EXISTS (SELECT 1 FROM messages t WHERE t.session_id = s.session_id AND t.turn_run_id = s.turn_run_id
          AND json_valid(t.metadata_json) AND json_extract(t.metadata_json, '$.type') = 'agentActivity'
          AND json_extract(t.metadata_json, '$.phase') = 'terminal')
    ) AS agent_activity_pending
    FROM ordered_messages o
    ${condition ? `WHERE ${condition.sql}` : ''}
    ORDER BY ${timelineProjectionOrderBy('ASC')}`, [conversationId, ...(condition?.params ?? [])]);
  return rows.flatMap((row) => {
    const cursor: ChatCanonicalCursor = [row.timeline_order_created_at, row.timeline_order_anchor_id, row.timeline_order_item_index, row.id];
    const item = projectChatContextMessage({ id: row.id, sessionId: row.session_id, text: row.text,
      isMe: row.is_me === 1, isRead: true, senderType: row.sender_type, time: row.time, createdAt: row.created_at,
      showTimeSeparatorBefore: false, status: row.status, deliveryStatus: row.delivery_status,
      metadataJson: row.metadata_json, replyToText: row.reply_to_text, logicalMessageId: row.logical_message_id }, cursor);
    // 整个自主 run 在终态前仍可追加条目，不能只保护当前正在流式写入的那一行。
    return item ? [{ ...item, ...(row.agent_activity_pending ? { pending: true as const } : {}) }] : [];
  });
}
async function insertSegment(tx: DatabaseTransactionExecutor, conversationId: string, id: string, content: string,
  now: string, timeZone: string, claim: ChatSummaryClaim | null, messages: readonly ConversationContextItem[],
  seen: Set<string>): Promise<void> {
  const times = messages.map((message) => message.timestamp).sort();
  let count = 0;
  for (const message of messages) {
    if (message.logicalIdentity !== null && !seen.has(message.logicalIdentity)) {
      seen.add(message.logicalIdentity); count++;
    }
  }
  const sequence = await tx.getFirstAsync<{ next_sequence: number }>('SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM chat_summary_segments WHERE conversation_id = ?', [conversationId]);
  await tx.runAsync(`INSERT INTO chat_summary_segments
    (id, conversation_id, sequence, content, from_cursor, to_cursor, message_count, batch_size, source_start_at, source_end_at, time_zone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [id, conversationId, sequence!.next_sequence, content, claim?.fromCursor ? JSON.stringify(claim.fromCursor) : null,
    claim?.toCursor ? JSON.stringify(claim.toCursor) : null, count, claim?.batchSize ?? null,
    times[0] ?? null, times[times.length - 1] ?? null, timeZone, now, now]);
}
export class SQLiteChatSummaryRepository implements ChatSummaryRepository {
  constructor(private readonly readCalls: CallSourceReader) {}

  async readContext(conversationId: string, protectedMessageIds: readonly number[]) {
    return executor('context').withExclusiveTransactionAsync(async (tx) => {
      const state = await readState(tx, conversationId);
      const raw = await readItems(tx, conversationId, { after: parseChatContextCursor(state.processed_cursor) });
      const protectedIds = new Set(protectedMessageIds);
      const visible = raw.filter((item) => !protectedIds.has(item.messageId));
      const calls = await this.readCalls(tx, conversationId, await readCallBoundary(tx, conversationId));
      return { segments: await readSegments(tx, conversationId), raw: visible,
        pendingCalls: calls, timeline: buildConversationTimeline(visible, calls) };
    });
  }
  async listConversationIds() {
    const rows = await executor('listConversations').getAllAsync<{ id: string }>('SELECT id FROM sessions ORDER BY updated_at DESC');
    return rows.map((row) => row.id);
  }
  async claim(conversationId: string, batchSize: number, claimId: string, now: string, expiresAt: string, timeZone: string): Promise<ChatSummaryClaim | null> {
    return executor('claim').withExclusiveTransactionAsync(async (tx) => {
      const state = await readState(tx, conversationId);
      if (state.claim_id !== null && state.claim_expires_at! > now) return null;
      if (state.claim_id !== null) await tx.runAsync('UPDATE chat_summary_state SET claim_id = NULL, claim_to_cursor = NULL, claim_expires_at = NULL WHERE conversation_id = ?', [conversationId]);
      const calls = await this.readCalls(tx, conversationId, await readCallBoundary(tx, conversationId));
      // 通话状态和原文在同一数据库快照读取，不能把 UI 的通话布尔值当业务锁。
      if (calls.some((call) => call.info.endedAt === null)) return null;
      const fromCursor = parseChatContextCursor(state.processed_cursor);
      const items = await readItems(tx, conversationId, { after: fromCursor });
      const turn = await tx.getFirstAsync<{ reply_cursor: number }>('SELECT reply_cursor FROM conversation_turn_state WHERE session_id = ?', [conversationId]);
      // 尚未交付的用户输入与仍会增长的自主过程必须留在原文中；游标越过后会丢失后续增量。
      const protectedIndex = items.findIndex((item) => item.pending === true
        || (item.kind === 'dialogue' && item.role === 'user' && item.messageId > (turn?.reply_cursor ?? 0)));
      const available = protectedIndex < 0 ? items : items.slice(0, protectedIndex);
      const protectedAt = protectedIndex < 0 ? null : items[protectedIndex].cursor[0];
      const timeline = buildConversationTimeline(available, calls);
      const eligible = protectedAt === null ? timeline : timeline.filter((item) => item.source === 'chat' || item.timestamp < protectedAt);
      const messages = selectSummaryRange(eligible, batchSize);
      if (!messages.length) return null;
      const messageIds = new Set(messages.map((message) => message.messageId));
      const selectedChat = available.filter((item) => messageIds.has(item.messageId));
      const toCursor = selectedChat.length ? selectedChat[selectedChat.length - 1].cursor : fromCursor;
      const callIds = new Set(messages.map((message) => message.callId));
      const claim: ChatSummaryClaim = { conversationId, claimId, generation: state.generation, revision: state.revision,
        fromCursor, toCursor, batchSize, messages, calls: calls.filter((call) => callIds.has(call.info.callId)),
        previous: await readSegments(tx, conversationId), timeZone };
      await tx.runAsync('UPDATE chat_summary_state SET claim_id = ?, claim_to_cursor = ?, claim_expires_at = ? WHERE conversation_id = ?',
        [claimId, claimKey(claim), expiresAt, conversationId]);
      return claim;
    });
  }
  async renewClaim(claim: ChatSummaryClaim, now: string, expiresAt: string) {
    const result = await executor('renew').runAsync(`UPDATE chat_summary_state SET claim_expires_at = ?
      WHERE conversation_id = ? AND generation = ? AND claim_id = ? AND claim_to_cursor = ? AND claim_expires_at > ?`,
    [expiresAt, claim.conversationId, claim.generation, claim.claimId, claimKey(claim), now]);
    return result.changes > 0;
  }
  async appendClaim(claim: ChatSummaryClaim, additions: readonly ChatSummaryAddition[], now: string) {
    return executor('append').withExclusiveTransactionAsync(async (tx) => {
      const result = await tx.runAsync(`UPDATE chat_summary_state SET processed_cursor = ?, revision = revision + 1,
        claim_id = NULL, claim_to_cursor = NULL, claim_expires_at = NULL
        WHERE conversation_id = ? AND generation = ? AND claim_id = ? AND claim_to_cursor = ? AND claim_expires_at > ?`,
      [claim.toCursor === null ? null : JSON.stringify(claim.toCursor), claim.conversationId,
        claim.generation, claim.claimId, claimKey(claim), now]);
      if (!result.changes) return false;
      // 同批的所有 5000 字分片完成后一起交接，失败不暴露半通电话或原文空洞。
      const seen = new Set<string>();
      for (const addition of additions) await insertSegment(tx, claim.conversationId, addition.id, addition.content,
        now, claim.timeZone, claim, addition.messages, seen);
      for (const call of claim.calls) await tx.runAsync('INSERT INTO chat_summary_processed_calls (conversation_id, call_id) VALUES (?, ?)',
        [claim.conversationId, call.info.callId]);
      return true;
    });
  }
  async releaseClaim(claim: ChatSummaryClaim) {
    await executor('release').runAsync('UPDATE chat_summary_state SET claim_id = NULL, claim_to_cursor = NULL, claim_expires_at = NULL WHERE conversation_id = ? AND generation = ? AND claim_id = ?',
      [claim.conversationId, claim.generation, claim.claimId]);
  }
  async create(conversationId: string, segmentId: string, content: string, now: string, timeZone: string) {
    await executor('create').withExclusiveTransactionAsync(async (tx) => {
      await readState(tx, conversationId);
      await insertSegment(tx, conversationId, segmentId, content, now, timeZone, null, [], new Set());
      await tx.runAsync('UPDATE chat_summary_state SET revision = revision + 1 WHERE conversation_id = ?', [conversationId]);
    });
  }
  async edit(conversationId: string, segmentId: string, content: string, now: string) {
    await executor('edit').withExclusiveTransactionAsync(async (tx) => {
      const result = await tx.runAsync('UPDATE chat_summary_segments SET content = ?, updated_at = ? WHERE conversation_id = ? AND id = ?', [content, now, conversationId, segmentId]);
      if (!result.changes) throw new Error('这段摘要已不存在');
      await tx.runAsync('UPDATE chat_summary_state SET revision = revision + 1 WHERE conversation_id = ?', [conversationId]);
    });
  }
  async delete(conversationId: string, segmentId: string) {
    await executor('delete').withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync('DELETE FROM chat_summary_segments WHERE conversation_id = ? AND id = ?', [conversationId, segmentId]);
      await tx.runAsync('UPDATE chat_summary_state SET revision = revision + 1 WHERE conversation_id = ?', [conversationId]);
    });
  }
  async clear(conversationId: string) {
    await executor('clear').withExclusiveTransactionAsync(async (tx) => {
      await readState(tx, conversationId);
      const items = await readItems(tx, conversationId, { visibleOnly: false });
      const cursor = items.length ? JSON.stringify(items[items.length - 1].cursor) : null;
      await tx.runAsync('DELETE FROM chat_summary_segments WHERE conversation_id = ?', [conversationId]);
      await tx.runAsync(`INSERT INTO chat_summary_call_boundary (conversation_id, cleared_at) VALUES (?, ?)
        ON CONFLICT(conversation_id) DO UPDATE SET cleared_at = excluded.cleared_at`, [conversationId, new Date().toISOString()]);
      await tx.runAsync(`UPDATE chat_summary_state SET generation = generation + 1, revision = revision + 1,
        processed_cursor = ?, claim_id = NULL, claim_to_cursor = NULL, claim_expires_at = NULL WHERE conversation_id = ?`, [cursor, conversationId]);
    });
  }
  async getNextWakeAt() {
    const row = await executor('nextWake').getFirstAsync<{ wake_at: string | null }>(
      'SELECT MIN(claim_expires_at) AS wake_at FROM chat_summary_state WHERE claim_id IS NOT NULL');
    return row!.wake_at;
  }
}
