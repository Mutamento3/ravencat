
/** 通话仓储的 SQLite 适配器，负责领域对象与数据库行之间的映射。 */

import {
  databaseCoordinator,
  type DatabaseReadExecutor,
  type DatabaseTransactionExecutor,
} from '@platform/persistence';
import type {
  CallSnapshotWriteResult,
  CreateCallSnapshotInput,
  ICallRepository,
  CreateCallEventInput,
  CreateCallParticipantInput,
  CreateCallSessionInput,
  UpdateCallEventInput,
  UpdateCallSessionInput,
} from '../domain/CallRepository';
import type { CallSession, CallState } from '../domain/CallSession';
import type {
  CallAttachment,
  CallEvent,
} from '../domain/CallEvent';
import type { CallParticipant } from '../domain/CallParticipant';
import type { CallContextInfo, CallSummarySource, CallSummaryTranscript } from '../domain/CallSummary';
import { SQLiteCallHistoryRepository } from './SQLiteCallHistoryRepository';

const ACTIVE_CALL_STATE_FILTER = "('requested', 'ringing', 'dialing', 'connecting', 'active', 'ending')";

interface CallSessionRow {
  id: string;
  chat_session_id: string;
  ai_assistant_id: string;
  agent_id: string;
  direction: string;
  state: string;
  requested_mode: string;
  active_mode: string;
  source: string;
  source_tool_call_id: string | null;
  opening_line: string | null;
  reason: string | null;
  ai_rejection_reason: string | null;
  started_at: string | null;
  accepted_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface CallParticipantRow {
  id: string;
  call_id: string;
  role: string;
  ai_assistant_id: string | null;
  agent_id: string | null;
  display_name: string;
  joined_at: string | null;
  left_at: string | null;
}

interface CallEventRow {
  id: string;
  call_id: string;
  chat_session_id: string;
  kind: string;
  actor_type: string;
  actor_id: string | null;
  text: string | null;
  attachment_id: string | null;
  visible_in_chat: number | null;
  include_in_ai_context: number | null;
  payload_json: string | null;
  created_at: string;
}

interface CallAttachmentRow {
  id: string;
  call_id: string;
  event_id: string | null;
  kind: string;
  local_uri: string | null;
  mime_type: string | null;
  width: number | null;
  height: number | null;
  size_bytes: number | null;
  created_at: string;
}

function createEntityId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class SQLiteCallRepository extends SQLiteCallHistoryRepository implements ICallRepository {
  async createSession(input: CreateCallSessionInput): Promise<CallSession> {
    return databaseCoordinator.transaction(
      { name: 'calls.createSession', feature: 'calls', priority: 'interactive' },
      (transaction) => this.createSessionInTransaction(transaction, input),
    );
  }

  async createSessionIfIdle(input: CreateCallSessionInput): Promise<CallSession | null> {
    return databaseCoordinator.transaction(
      { name: 'calls.createSessionIfIdle', feature: 'calls', priority: 'interactive' },
      async (transaction) => {
        const occupied = await transaction.getFirstAsync(
          `SELECT 1 FROM call_sessions WHERE state IN ${ACTIVE_CALL_STATE_FILTER} LIMIT 1`,
        );
        if (occupied) return null;
        return this.createSessionInTransaction(transaction, input);
      },
    );
  }

  private async createSessionInTransaction(db: DatabaseTransactionExecutor, input: CreateCallSessionInput): Promise<CallSession> {
    const now = new Date().toISOString();
    const id = input.id || createEntityId('call');
    const state = input.state || 'requested';
    const activeMode = input.activeMode || input.requestedMode;

    await db.runAsync(
      `INSERT INTO call_sessions
       (id, chat_session_id, ai_assistant_id, agent_id, direction, state, requested_mode, active_mode,
        source, source_tool_call_id, opening_line, reason, ai_rejection_reason, started_at, accepted_at,
        ended_at, end_reason, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.chatSessionId,
        input.aiAssistantId,
        input.agentId,
        input.direction,
        state,
        input.requestedMode,
        activeMode,
        input.source,
        input.sourceToolCallId || null,
        input.openingLine || null,
        input.reason || null,
        input.aiRejectionReason || null,
        input.startedAt || null,
        input.acceptedAt || null,
        input.endedAt || null,
        input.endReason || null,
        now,
        now,
      ]
    );

    await this.createHistoryInTransaction(db, id, input.aiAssistantId, input.startedAt || now);
    const row = await db.getFirstAsync<CallSessionRow>('SELECT * FROM call_sessions WHERE id = ?', [id]);
    return this.mapSessionRow(row!);
  }

  async updateSession(id: string, patch: UpdateCallSessionInput): Promise<CallSession> {
    const session = await this.updateSessionFields(id, patch);
    if (!session) {
      throw new Error(`Call session ${id} not found after update`);
    }
    return session;
  }

  async updateSessionIfState(
    id: string,
    expectedStates: [CallState, ...CallState[]],
    patch: UpdateCallSessionInput
  ): Promise<CallSession | null> {
    return this.updateSessionFields(id, patch, expectedStates);
  }

  private async updateSessionFields(
    id: string,
    patch: UpdateCallSessionInput,
    expectedStates?: [CallState, ...CallState[]]
  ): Promise<CallSession | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.updateSessionFields', feature: 'calls', priority: 'interactive' });
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.state !== undefined) {
      fields.push('state = ?');
      values.push(patch.state);
    }
    if (patch.activeMode !== undefined) {
      fields.push('active_mode = ?');
      values.push(patch.activeMode);
    }
    if (patch.sourceToolCallId !== undefined) {
      fields.push('source_tool_call_id = ?');
      values.push(patch.sourceToolCallId);
    }
    if (patch.openingLine !== undefined) {
      fields.push('opening_line = ?');
      values.push(patch.openingLine);
    }
    if (patch.reason !== undefined) {
      fields.push('reason = ?');
      values.push(patch.reason);
    }
    if (patch.aiRejectionReason !== undefined) {
      fields.push('ai_rejection_reason = ?');
      values.push(patch.aiRejectionReason);
    }
    if (patch.startedAt !== undefined) {
      fields.push('started_at = ?');
      values.push(patch.startedAt);
    }
    if (patch.acceptedAt !== undefined) {
      fields.push('accepted_at = ?');
      values.push(patch.acceptedAt);
    }
    if (patch.endedAt !== undefined) {
      fields.push('ended_at = ?');
      values.push(patch.endedAt);
    }
    if (patch.endReason !== undefined) {
      fields.push('end_reason = ?');
      values.push(patch.endReason);
    }

    fields.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);

    let stateClause = '';
    if (expectedStates) {
      stateClause = ` AND state IN (${expectedStates.map(() => '?').join(', ')})`;
      values.push(...expectedStates);
    }

    const result = await db.runAsync(
      `UPDATE call_sessions SET ${fields.join(', ')} WHERE id = ?${stateClause}`,
      values
    );
    if (result.changes === 0) {
      return null;
    }

    const session = await this.getSessionById(id);
    if (!session) {
      throw new Error(`Call session ${id} not found after update`);
    }
    return session;
  }

  async getSessionById(id: string): Promise<CallSession | null> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.getSessionById', feature: 'calls', priority: 'interactive' });
      const row = await db.getFirstAsync<CallSessionRow>(
        'SELECT * FROM call_sessions WHERE id = ?',
        [id]
      );
      return row ? this.mapSessionRow(row) : null;
    } catch (error) {
      console.error('[CallRepository] Failed to get call session:', error);
      return null;
    }
  }

  async getActiveSession(): Promise<CallSession | null> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.getActiveSession', feature: 'calls', priority: 'interactive' });
      const row = await db.getFirstAsync<CallSessionRow>(
        `SELECT * FROM call_sessions
         WHERE state IN ${ACTIVE_CALL_STATE_FILTER}
         ORDER BY updated_at DESC
         LIMIT 1`
      );
      return row ? this.mapSessionRow(row) : null;
    } catch (error) {
      console.error('[CallRepository] Failed to get active call session:', error);
      return null;
    }
  }

  async listRecentSessions(params: { chatSessionId?: string; limit: number }): Promise<CallSession[]> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.listRecentSessions', feature: 'calls', priority: 'interactive' });
      const rows = params.chatSessionId
        ? await db.getAllAsync<CallSessionRow>(
          `SELECT * FROM call_sessions
           WHERE chat_session_id = ?
           ORDER BY created_at DESC
           LIMIT ?`,
          [params.chatSessionId, params.limit]
        )
        : await db.getAllAsync<CallSessionRow>(
          `SELECT * FROM call_sessions
           ORDER BY created_at DESC
           LIMIT ?`,
          [params.limit]
        );
      return rows.map((row) => this.mapSessionRow(row));
    } catch (error) {
      console.error('[CallRepository] Failed to list recent call sessions:', error);
      return [];
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.deleteSession', feature: 'calls', priority: 'interactive' });
    await db.runAsync('DELETE FROM call_sessions WHERE id = ?', [id]);
    return true;
  }

  async addParticipant(input: CreateCallParticipantInput): Promise<CallParticipant> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.addParticipant', feature: 'calls', priority: 'interactive' });
    const id = input.id || createEntityId('call_participant');

    await db.runAsync(
      `INSERT INTO call_participants
       (id, call_id, role, ai_assistant_id, agent_id, display_name, joined_at, left_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.callId,
        input.role,
        input.aiAssistantId || null,
        input.agentId || null,
        input.displayName,
        input.joinedAt || null,
        input.leftAt || null,
      ]
    );

    const row = await db.getFirstAsync<CallParticipantRow>(
      'SELECT * FROM call_participants WHERE id = ?',
      [id]
    );
    if (!row) {
      throw new Error(`Failed to retrieve inserted call participant ${id}`);
    }
    return this.mapParticipantRow(row);
  }

  async listParticipants(callId: string): Promise<CallParticipant[]> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.listParticipants', feature: 'calls', priority: 'interactive' });
      const rows = await db.getAllAsync<CallParticipantRow>(
        `SELECT * FROM call_participants
         WHERE call_id = ?
         ORDER BY joined_at ASC, id ASC`,
        [callId]
      );
      return rows.map((row) => this.mapParticipantRow(row));
    } catch (error) {
      console.error('[CallRepository] Failed to list call participants:', error);
      return [];
    }
  }

  async appendEvent(input: CreateCallEventInput): Promise<CallEvent> {
    return databaseCoordinator.transaction({ name: 'calls.appendEvent', feature: 'calls', priority: 'interactive' }, async db => {
      const id = input.id || createEntityId('call_event');
      const createdAt = input.createdAt || new Date().toISOString();

      await db.runAsync(
        `INSERT INTO call_events
         (id, call_id, chat_session_id, kind, actor_type, actor_id, text, attachment_id,
          visible_in_chat, include_in_ai_context, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.callId,
          input.chatSessionId,
          input.kind,
          input.actorType,
          input.actorId || null,
          input.text || null,
          input.attachmentId || null,
          input.visibleInChat ? 1 : 0,
          input.includeInAIContext === false ? 0 : 1,
          input.payloadJson || null,
          createdAt,
        ]
      );

      const row = await db.getFirstAsync<CallEventRow>(
        'SELECT * FROM call_events WHERE id = ?',
        [id]
      );
      if (!row) {
        throw new Error(`Failed to retrieve inserted call event ${id}`);
      }
      if (input.kind === 'userSpeechText') {
        await this.appendHistoryEntryInTransaction(db, {
          id, callId: input.callId, speaker: 'user', text: input.text!, createdAt,
          inputKind: input.payloadJson ? JSON.parse(input.payloadJson).inputKind : 'text',
        });
      }
      return this.mapEventRow(row);
    });
  }

  async appendSnapshot(input: CreateCallSnapshotInput): Promise<CallSnapshotWriteResult> {
    const eventId = input.event.id || createEntityId('call_event');
    const attachmentId = input.attachment.id || createEntityId('call_attachment');
    const eventCreatedAt = input.event.createdAt || new Date().toISOString();
    const attachmentCreatedAt = input.attachment.createdAt || eventCreatedAt;

    return databaseCoordinator.transaction(
      {
        name: 'calls.appendSnapshot',
        feature: 'calls',
        priority: 'interactive',
      },
      async (tx: DatabaseTransactionExecutor) => {
        // 文件准备期间通话可能已结束；在事实提交的同一事务内确认 active。
        const active = await tx.getFirstAsync<{ state: CallState }>('SELECT state FROM call_sessions WHERE id = ?', [input.callId]);
        if (!active || active.state !== 'active') throw new Error('通话已结束，无法保存快照');
        // call_events 不反向约束 attachment_id，因此先写事件，再写带 event_id 的附件。
        await tx.runAsync(
          `INSERT INTO call_events
           (id, call_id, chat_session_id, kind, actor_type, actor_id, text, attachment_id,
            visible_in_chat, include_in_ai_context, payload_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            input.callId,
            input.chatSessionId,
            input.event.kind,
            input.event.actorType,
            input.event.actorId || null,
            input.event.text || null,
            attachmentId,
            input.event.visibleInChat ? 1 : 0,
            input.event.includeInAIContext === false ? 0 : 1,
            input.event.payloadJson || null,
            eventCreatedAt,
          ]
        );

        await tx.runAsync(
          `INSERT INTO call_attachments
           (id, call_id, event_id, kind, local_uri, mime_type, width, height, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            attachmentId,
            input.callId,
            eventId,
            input.attachment.kind,
            input.attachment.localUri || null,
            input.attachment.mimeType || null,
            input.attachment.width ?? null,
            input.attachment.height ?? null,
            input.attachment.sizeBytes ?? null,
            attachmentCreatedAt,
          ]
        );

        const eventRow = await tx.getFirstAsync<CallEventRow>(
          'SELECT * FROM call_events WHERE id = ?',
          [eventId]
        );
        if (!eventRow) {
          throw new Error(`Failed to retrieve inserted call event ${eventId}`);
        }

        const attachmentRow = await tx.getFirstAsync<CallAttachmentRow>(
          'SELECT * FROM call_attachments WHERE id = ?',
          [attachmentId]
        );
        if (!attachmentRow) {
          throw new Error(`Failed to retrieve inserted call attachment ${attachmentId}`);
        }

        return {
          event: this.mapEventRow(eventRow),
          attachment: this.mapAttachmentRow(attachmentRow),
        };
      }
    );
  }

  async listEvents(params: { callId: string; limit?: number }): Promise<CallEvent[]> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.listEvents', feature: 'calls', priority: 'interactive' });
      const limit = params.limit || 100;
      const rows = await db.getAllAsync<CallEventRow>(
        `SELECT * FROM (
           SELECT * FROM call_events
           WHERE call_id = ?
           ORDER BY created_at DESC
           LIMIT ?
         )
         ORDER BY created_at ASC`,
        [params.callId, limit]
      );
      return rows.map((row) => this.mapEventRow(row));
    } catch (error) {
      console.error('[CallRepository] Failed to list call events:', error);
      return [];
    }
  }

  async updateEvent(id: string, patch: UpdateCallEventInput): Promise<CallEvent> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.updateEvent', feature: 'calls', priority: 'interactive' });
    const fields: string[] = [];
    const values: (string | number | null)[] = [];

    if (patch.text !== undefined) {
      fields.push('text = ?');
      values.push(patch.text);
    }
    if (patch.attachmentId !== undefined) {
      fields.push('attachment_id = ?');
      values.push(patch.attachmentId);
    }
    if (patch.visibleInChat !== undefined) {
      fields.push('visible_in_chat = ?');
      values.push(patch.visibleInChat ? 1 : 0);
    }
    if (patch.includeInAIContext !== undefined) {
      fields.push('include_in_ai_context = ?');
      values.push(patch.includeInAIContext ? 1 : 0);
    }
    if (patch.payloadJson !== undefined) {
      fields.push('payload_json = ?');
      values.push(patch.payloadJson);
    }

    if (fields.length > 0) {
      values.push(id);
      await db.runAsync(`UPDATE call_events SET ${fields.join(', ')} WHERE id = ?`, values);
    }

    const row = await db.getFirstAsync<CallEventRow>(
      'SELECT * FROM call_events WHERE id = ?',
      [id]
    );
    if (!row) {
      throw new Error(`Call event ${id} not found after update`);
    }
    return this.mapEventRow(row);
  }

  async deleteEvent(id: string): Promise<boolean> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.deleteEvent', feature: 'calls', priority: 'interactive' });
    await db.runAsync('DELETE FROM call_events WHERE id = ?', [id]);
    return true;
  }

  /**
   * conversation 可见历史边界之后产生的通话上下文事件。
   *
   * CallEvent 没有数值 / 单调 cursor（id 是 `call_event_<epochMs>_<random>` 文本，
   * 随机后缀破坏同毫秒序），所以「清除聊天记录」对它只能用时间表达：该操作把
   * sessions.visible_after_at 写成清除时刻，这里只读严格晚于该时刻的事件。
   * 两列都是 `new Date().toISOString()` 产物（定宽 UTC ISO-8601），字符串比较即时间序。
   *
   * 关键：边界落在**事件**上而不是 callId 上。同一通电话在清除前产生的事件不可见，
   * 清除后继续产生的 speech / context 事件照常进入 Prompt（callStatus 锚点行本身
   * 由 Chat message 边界负责）。
   */
  async listContextEvents(params: { chatSessionId: string; limit: number }): Promise<CallEvent[]> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.listContextEvents', feature: 'calls', priority: 'interactive' });
      const rows = await db.getAllAsync<CallEventRow>(
        `SELECT e.* FROM call_events e
         LEFT JOIN sessions s ON s.id = e.chat_session_id
         WHERE e.chat_session_id = ?
           AND e.include_in_ai_context = 1
           AND (s.visible_after_at IS NULL OR e.created_at > s.visible_after_at)
         ORDER BY e.created_at DESC
         LIMIT ?`,
        [params.chatSessionId, params.limit]
      );
      return rows
        .map((row) => this.mapEventRow(row))
        .reverse();
    } catch (error) {
      console.error('[CallRepository] Failed to list call context events:', error);
      return [];
    }
  }

  async listSummarySources(params: {
    chatSessionId: string; excludedCallIds: readonly string[]; after: string | null;
  }): Promise<CallSummarySource[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'calls.summarySources', feature: 'calls', priority: 'maintenance' });
    return this.readSummarySources(db, params);
  }

  /** Host 在 Chat 的同一事务内装配只读事实，避免通话状态与摘要领取之间的竞态。 */
  async readSummarySources(db: DatabaseReadExecutor, params: {
    chatSessionId: string; excludedCallIds: readonly string[]; after: string | null;
  }): Promise<CallSummarySource[]> {
    const rows = await db.getAllAsync<{
      call_id: string; active_mode: CallContextInfo['mediaMode']; direction: CallContextInfo['direction'];
      state: CallState; started_at: string; accepted_at: string | null; ended_at: string | null;
      end_reason: CallContextInfo['endReason']; history_starts_after: string | null;
      event_id: string | null; event_created_at: string; event_kind: string; text: string;
    }>(`WITH eligible AS (
      SELECT c.*, MAX(COALESCE(s.visible_after_at, ''), COALESCE(?, '')) AS history_starts_after
      FROM call_sessions c JOIN sessions s ON s.id = c.chat_session_id
      WHERE c.chat_session_id = ?
        AND c.id NOT IN (SELECT value FROM json_each(?))
    ) SELECT c.id AS call_id, c.active_mode, c.direction, c.state,
      COALESCE(c.started_at, c.created_at) AS started_at, c.accepted_at, c.ended_at, c.end_reason,
      NULLIF(c.history_starts_after, '') AS history_starts_after,
      e.id AS event_id, e.created_at AS event_created_at, e.kind AS event_kind, e.text
      FROM eligible c LEFT JOIN call_events e ON e.call_id = c.id
        AND e.include_in_ai_context = 1 AND e.created_at > c.history_starts_after
        AND e.kind != 'stateChanged'
        AND length(trim(e.text)) > 0
      WHERE c.ended_at IS NULL OR c.ended_at > c.history_starts_after
      ORDER BY COALESCE(c.accepted_at, c.started_at, c.created_at), c.id, e.created_at, e.id`,
    [params.after, params.chatSessionId, JSON.stringify(params.excludedCallIds)]);
    const sources = new Map<string, CallSummarySource>();
    for (const row of rows) {
      let source = sources.get(row.call_id);
      if (!source) {
        const durationSeconds = row.accepted_at !== null && row.ended_at !== null
          ? Math.floor((Date.parse(row.ended_at) - Date.parse(row.accepted_at)) / 1000) : null;
        if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds < 0)) throw new Error('通话时间事实损坏');
        source = { info: { callId: row.call_id, mediaMode: row.active_mode, direction: row.direction,
          state: row.state, startedAt: row.started_at, acceptedAt: row.accepted_at,
          endedAt: row.ended_at, endReason: row.end_reason, durationSeconds },
        historyStartsAfter: row.history_starts_after, transcripts: [] };
        sources.set(row.call_id, source);
      }
      if (row.event_id !== null) {
        const speaker: CallSummaryTranscript['speaker'] = row.event_kind === 'userSpeechText' ? 'user'
          : row.event_kind === 'aiSpeechText' ? 'assistant' : 'application';
        source.transcripts.push({ eventId: row.event_id, timestamp: row.event_created_at, speaker,
          content: speaker === 'application' ? '[' + row.event_kind + '] ' + row.text : row.text });
      }
    }
    return [...sources.values()];
  }

  listSnapshotFiles(callId?: string): Promise<{ id: string; uri: string }[]> {
    return databaseCoordinator.read({ name: 'calls.snapshot-files', feature: 'calls', priority: 'maintenance' }, (db) =>
      db.getAllAsync<{ id: string; uri: string }>(`SELECT id, local_uri AS uri FROM call_attachments WHERE kind = 'snapshot' AND local_uri IS NOT NULL${callId === undefined ? '' : ' AND call_id = ?'}`, callId === undefined ? [] : [callId]));
  }

  async clearSnapshotFile(id: string, expectedUri: string): Promise<void> {
    await databaseCoordinator.write({ name: 'calls.expire-snapshot', feature: 'calls', priority: 'maintenance' }, (db) =>
      db.runAsync("UPDATE call_attachments SET local_uri = NULL WHERE id = ? AND kind = 'snapshot' AND local_uri = ?", [id, expectedUri]));
  }

  async assertBackupSnapshotHasNoFiles(executor: Pick<DatabaseTransactionExecutor, 'getFirstAsync'>): Promise<void> {
    const snapshot = await executor.getFirstAsync("SELECT 1 FROM call_attachments WHERE kind = 'snapshot' AND local_uri IS NOT NULL LIMIT 1");
    if (snapshot) throw new Error('备份不应包含通话临时快照地址');
  }

  /** 只裁剪待打包副本，活动通话的快照和隐藏事件不受影响。 */
  async clearSnapshotReferencesInTransaction(transaction: DatabaseTransactionExecutor): Promise<void> {
    await transaction.runAsync("UPDATE call_attachments SET local_uri = NULL WHERE kind = 'snapshot'");
  }

  async listAttachments(callId: string): Promise<CallAttachment[]> {
    try {
      const db = databaseCoordinator.openTaskExecutor({ name: 'calls.listAttachments', feature: 'calls', priority: 'interactive' });
      const rows = await db.getAllAsync<CallAttachmentRow>(
        `SELECT * FROM call_attachments
         WHERE call_id = ?
         ORDER BY created_at DESC`,
        [callId]
      );
      return rows.map((row) => this.mapAttachmentRow(row));
    } catch (error) {
      console.error('[CallRepository] Failed to list call attachments:', error);
      return [];
    }
  }

  private mapSessionRow(row: CallSessionRow): CallSession {
    return {
      id: row.id,
      chatSessionId: row.chat_session_id,
      aiAssistantId: row.ai_assistant_id,
      agentId: row.agent_id,
      direction: row.direction as CallSession['direction'],
      state: row.state as CallSession['state'],
      requestedMode: row.requested_mode as CallSession['requestedMode'],
      activeMode: row.active_mode as CallSession['activeMode'],
      source: row.source as CallSession['source'],
      sourceToolCallId: row.source_tool_call_id,
      openingLine: row.opening_line,
      reason: row.reason,
      aiRejectionReason: row.ai_rejection_reason,
      startedAt: row.started_at,
      acceptedAt: row.accepted_at,
      endedAt: row.ended_at,
      endReason: row.end_reason as CallSession['endReason'],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapParticipantRow(row: CallParticipantRow): CallParticipant {
    return {
      id: row.id,
      callId: row.call_id,
      role: row.role as CallParticipant['role'],
      aiAssistantId: row.ai_assistant_id,
      agentId: row.agent_id,
      displayName: row.display_name,
      joinedAt: row.joined_at,
      leftAt: row.left_at,
    };
  }

  private mapEventRow(row: CallEventRow): CallEvent {
    return {
      id: row.id,
      callId: row.call_id,
      chatSessionId: row.chat_session_id,
      kind: row.kind as CallEvent['kind'],
      actorType: row.actor_type as CallEvent['actorType'],
      actorId: row.actor_id,
      text: row.text,
      attachmentId: row.attachment_id,
      visibleInChat: row.visible_in_chat === 1,
      includeInAIContext: row.include_in_ai_context !== 0,
      payloadJson: row.payload_json,
      createdAt: row.created_at,
    };
  }

  private mapAttachmentRow(row: CallAttachmentRow): CallAttachment {
    return {
      id: row.id,
      callId: row.call_id,
      eventId: row.event_id,
      kind: row.kind as CallAttachment['kind'],
      localUri: row.local_uri,
      mimeType: row.mime_type,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    };
  }
}

export const callRepository = new SQLiteCallRepository();
