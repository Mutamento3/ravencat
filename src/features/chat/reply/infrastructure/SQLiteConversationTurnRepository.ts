/**
 * @fileoverview ConversationTurnCoordinator 的 SQLite 回合仓储实现。
 *
 * 四类状态转换事务（方案 13 / 16 节）：
 * - T1：ensureTurnStateRowInTransaction + supersedeActiveRunInTransaction
 * - T2：claimIfIdle（CAS 含 active_run_id IS NULL）/ takeOverOrphan（事务内 supersede 孤儿）
 * - T3：commitTurn（fence + 全量 items + preview + run 终态 + 游标 + revision 单事务）
 * - T4：revoke（cancel / fail）
 *
 * 所有关键条件 UPDATE 检查影响行数；0 行即整事务回滚并报 invariant violation，
 * 由 databaseCoordinator 包装时保留原始 cause 与任务元数据，不自动重试。
 */

import {
  databaseCoordinator,
  type DatabaseTransactionExecutor,
  type DatabaseReadExecutor,
} from '@platform/persistence';
import { cancelRegenerationInTransaction } from '../../messages/infrastructure/ChatMessageMutationSql';
import { messageRepository } from '../../messages/infrastructure/SQLiteMessageRepository';
import {
  ConversationTurnInvariantError,
  type ConversationTurnKind,
  type ConversationTurnRun,
  type ConversationTurnRunStatus,
  type ConversationTurnTerminalStatus,
  type ConversationTurnCommitItem,
  type ConversationToolPackageCommit,
  type ConversationTurnCommitResult,
  type ConversationTurnUnrepliedSession,
  type ChatRegenerationState,
} from '../domain/ConversationTurn';
import { buildSessionPreviewTextFromMessage } from '../../messages/domain';
import type { IConversationTurnRepository } from '../domain/ConversationTurnRepository';

interface TurnRunRow {
  run_id: string;
  session_id: string;
  kind: string;
  reply_cursor_at_claim: number;
  input_high_watermark: number;
  revision_at_claim: number;
  status: ConversationTurnRunStatus;
  terminal_reason: string | null;
  created_at: string;
  terminal_at: string | null;
  regeneration_source_run_id: string | null;
  input_cursor_at_claim: number | null;
}

interface TurnStateRow {
  reply_cursor: number;
  revision: number;
  active_run_id: string | null;
}

function createTurnRunId(): string {
  return `turn_run_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapRowToRun(row: TurnRunRow): ConversationTurnRun {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    kind: row.kind as ConversationTurnKind,
    replyCursorAtClaim: row.reply_cursor_at_claim,
    inputHighWatermark: row.input_high_watermark,
    revisionAtClaim: row.revision_at_claim,
    status: row.status,
    terminalReason: row.terminal_reason,
    createdAt: row.created_at,
    terminalAt: row.terminal_at,
    regenerationSourceRunId: row.regeneration_source_run_id,
    inputCursorAtClaim: row.input_cursor_at_claim,
  };
}

export class ConversationTurnRepository implements IConversationTurnRepository {
  /** 资格读取和请求事务共用同一判据，不按分页列表猜测最新回复。 */
  private async eligibleRegenerationSource(db: DatabaseReadExecutor, sessionId: string): Promise<TurnRunRow | null> {
    return db.getFirstAsync<TurnRunRow>(
      `SELECT r.* FROM conversation_turn_runs r
       JOIN conversation_turn_state s ON s.session_id = r.session_id
       JOIN sessions c ON c.id = r.session_id
       WHERE r.session_id = ? AND r.status = 'committed' AND r.kind IN ('user_reply', 'regenerate')
         AND s.active_run_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM chat_regeneration_requests q WHERE q.session_id = r.session_id)
         AND r.input_high_watermark = s.reply_cursor
         AND r.run_id = (SELECT m.turn_run_id FROM messages m
           WHERE m.session_id = r.session_id AND m.sender_type = 'assistant' AND m.status = 'sent'
             AND m.id > COALESCE(c.visible_after_message_id, 0)
           ORDER BY m.id DESC LIMIT 1)
         AND EXISTS (SELECT 1 FROM messages m WHERE m.turn_run_id = r.run_id
           AND m.turn_item_index IS NOT NULL AND m.sender_type = 'assistant')
         AND EXISTS (SELECT 1 FROM messages u WHERE u.session_id = r.session_id AND u.is_me = 1
           AND u.id > COALESCE(r.input_cursor_at_claim, r.reply_cursor_at_claim)
           AND u.id <= r.input_high_watermark AND json_extract(u.metadata_json, '$.type') IS NOT 'callStatus')
         AND NOT EXISTS (SELECT 1 FROM messages u WHERE u.session_id = r.session_id AND u.is_me = 1
           AND u.id > r.input_high_watermark AND json_extract(u.metadata_json, '$.type') IS NOT 'callStatus')`,
      [sessionId],
    );
  }

  async getRegenerationState(sessionId: string): Promise<ChatRegenerationState> {
    return databaseCoordinator.read(
      { name: 'chat.regeneration-state', feature: 'chat', priority: 'interactive' },
      async (db) => {
        const pending = await db.getFirstAsync<{ source_run_id: string; active_run_id: string | null }>(
          `SELECT source_run_id, NULL AS active_run_id FROM chat_regeneration_requests WHERE session_id = ?
           UNION ALL SELECT r.regeneration_source_run_id, r.run_id FROM conversation_turn_state s
           JOIN conversation_turn_runs r ON r.run_id = s.active_run_id
           WHERE s.session_id = ? AND r.kind = 'regenerate' LIMIT 1`, [sessionId, sessionId],
        );
        const sourceRunId = pending?.source_run_id ?? null;
        const rows = sourceRunId ? await db.getAllAsync<{ id: number }>(
          'SELECT id FROM messages WHERE turn_run_id = ? AND turn_item_index IS NOT NULL', [sourceRunId],
        ) : [];
        const eligible = sourceRunId ? null : await this.eligibleRegenerationSource(db, sessionId);
        return { eligibleRunId: eligible?.run_id ?? null, sourceRunId, hiddenMessageIds: rows.map((row) => row.id),
          ...(pending?.active_run_id ? { activeRunId: pending.active_run_id } : {}) };
      },
    );
  }

  requestRegeneration(sessionId: string, messageId: number): Promise<number> {
    return databaseCoordinator.transaction(
      { name: 'chat.request-regeneration', feature: 'chat', priority: 'interactive' },
      async (transaction) => {
        const source = await this.eligibleRegenerationSource(transaction, sessionId);
        const target = await transaction.getFirstAsync<{ turn_run_id: string; sender_type: string; turn_item_index: number | null }>(
          'SELECT turn_run_id, sender_type, turn_item_index FROM messages WHERE id = ? AND session_id = ?',
          [messageId, sessionId],
        );
        if (!source || target?.turn_run_id !== source.run_id || target.sender_type !== 'assistant' || target.turn_item_index === null) {
          throw new Error('只能重写没有后续用户消息的最新一轮 AI 回复');
        }
        // 每次意图拥有独立 revision，原生启动的迟到失败不能撤销后来一次请求。
        await transaction.runAsync(
          'UPDATE conversation_turn_state SET revision = revision + 1 WHERE session_id = ?', [sessionId],
        );
        await transaction.runAsync(
          `INSERT INTO chat_regeneration_requests (session_id, source_run_id, revision)
           SELECT session_id, ?, revision FROM conversation_turn_state WHERE session_id = ?`, [source.run_id, sessionId],
        );
        const request = await transaction.getFirstAsync<{ revision: number }>(
          'SELECT revision FROM chat_regeneration_requests WHERE session_id = ?', [sessionId],
        );
        return request!.revision;
      },
    );
  }

  cancelRegeneration(sessionId: string, requestRevision: number): Promise<void> {
    return databaseCoordinator.transaction(
      { name: 'chat.cancel-regeneration', feature: 'chat', priority: 'interactive' },
      async (transaction) => {
        const owned = await transaction.getFirstAsync<{ revision: number }>(
          `SELECT revision FROM chat_regeneration_requests WHERE session_id = ? AND revision = ?
           UNION ALL SELECT r.revision_at_claim FROM conversation_turn_state s
           JOIN conversation_turn_runs r ON r.run_id = s.active_run_id
           WHERE s.session_id = ? AND r.kind = 'regenerate' AND r.revision_at_claim = ?`,
          [sessionId, requestRevision, sessionId, requestRevision + 1],
        );
        if (owned) await cancelRegenerationInTransaction(transaction, sessionId);
      },
    );
  }

  async ensureTurnStateRowInTransaction(
    transaction: DatabaseTransactionExecutor,
    sessionId: string,
  ): Promise<void> {
    await transaction.runAsync(
      `INSERT OR IGNORE INTO conversation_turn_state
         (session_id, reply_cursor, revision, active_run_id, active_run_kind, updated_at)
       VALUES (?, 0, 0, NULL, NULL, ?)`,
      [sessionId, new Date().toISOString()],
    );
  }

  async supersedeActiveRunInTransaction(
    transaction: DatabaseTransactionExecutor,
    sessionId: string,
  ): Promise<string | null> {
    await transaction.runAsync('DELETE FROM chat_regeneration_requests WHERE session_id = ?', [sessionId]);
    const state = await transaction.getFirstAsync<Pick<TurnStateRow, 'active_run_id'>>(
      `SELECT active_run_id FROM conversation_turn_state WHERE session_id = ?`,
      [sessionId],
    );
    if (!state || state.active_run_id === null) {
      return null;
    }
    const now = new Date().toISOString();
    const superseded = await transaction.runAsync(
      `UPDATE conversation_turn_runs
       SET status = 'superseded', terminal_at = ?
       WHERE run_id = ? AND status = 'active'`,
      [now, state.active_run_id],
    );
    if (superseded.changes !== 1) {
      throw new ConversationTurnInvariantError(
        `supersedeActiveRun：run ${state.active_run_id} 期望为 active，实际影响 ${superseded.changes} 行`,
      );
    }
    const cleared = await transaction.runAsync(
      `UPDATE conversation_turn_state
       SET active_run_id = NULL, active_run_kind = NULL, revision = revision + 1, updated_at = ?
       WHERE session_id = ? AND active_run_id = ?`,
      [now, sessionId, state.active_run_id],
    );
    if (cleared.changes !== 1) {
      throw new ConversationTurnInvariantError(
        `supersedeActiveRun：turn_state 清理 active_run_id 影响 ${cleared.changes} 行`,
      );
    }
    return state.active_run_id;
  }

  claimIfIdle(
    sessionId: string,
    kind: ConversationTurnKind,
  ): Promise<ConversationTurnRun | null> {
    return databaseCoordinator.transaction(
      { name: 'chat.claim-turn-if-idle', feature: 'chat', priority: 'interactive' },
      (transaction) => this.claimInTransaction(transaction, sessionId, kind, 'claim_if_idle'),
    );
  }

  takeOverOrphan(
    sessionId: string,
    kind: ConversationTurnKind,
  ): Promise<ConversationTurnRun | null> {
    return databaseCoordinator.transaction(
      { name: 'chat.take-over-orphan-turn', feature: 'chat', priority: 'runtime' },
      (transaction) => this.claimInTransaction(transaction, sessionId, kind, 'take_over_orphan'),
    );
  }

  /**
   * T2 claim：读 turn_state → 计算高水位 → 插 run 行（先于 turn_state 更新，满足外键引用顺序）
   * → 按需 supersede 旧 active run → CAS 更新 turn_state（revision 断言，0 行即回滚）。
   */
  private async claimInTransaction(
    transaction: DatabaseTransactionExecutor,
    sessionId: string,
    kind: ConversationTurnKind,
    mode: 'claim_if_idle' | 'take_over_orphan',
  ): Promise<ConversationTurnRun | null> {
    const now = new Date().toISOString();
    await this.ensureTurnStateRowInTransaction(transaction, sessionId);
    const state = await transaction.getFirstAsync<TurnStateRow>(
      `SELECT reply_cursor, revision, active_run_id
       FROM conversation_turn_state WHERE session_id = ?`,
      [sessionId],
    );
    if (!state) {
      throw new ConversationTurnInvariantError(`claim：会话 ${sessionId} 缺少 turn_state 行`);
    }
    const request = await transaction.getFirstAsync<{ source_run_id: string; revision: number }>(
      'SELECT * FROM chat_regeneration_requests WHERE session_id = ?', [sessionId],
    );
    const source = request ? await transaction.getFirstAsync<TurnRunRow>(
      'SELECT * FROM conversation_turn_runs WHERE run_id = ?', [request.source_run_id],
    ) : null;
    if (request && request.revision !== state.revision) {
      await transaction.runAsync('DELETE FROM chat_regeneration_requests WHERE session_id = ?', [sessionId]);
      return null;
    }
    // 重写孤儿只恢复旧回复；隐式接管会重复运行已经发生过的工具。
    if (mode === 'take_over_orphan' && state.active_run_id !== null) {
      const orphan = await transaction.getFirstAsync<{ kind: string }>(
        'SELECT kind FROM conversation_turn_runs WHERE run_id = ?', [state.active_run_id],
      );
      if (orphan?.kind === 'regenerate') {
        await cancelRegenerationInTransaction(transaction, sessionId);
        return null;
      }
    }
    const runKind: ConversationTurnKind = source ? 'regenerate' : kind;
    // 高水位只统计 canonical 用户消息；通话状态虽标记为用户方向，但不属于 user_reply 输入。
    const highWatermarkRow = await transaction.getFirstAsync<{ hw: number | null }>(
      `SELECT MAX(id) AS hw FROM messages
       WHERE session_id = ?
         AND is_me = 1
         AND json_extract(metadata_json, '$.type') IS NOT 'callStatus'`,
      [sessionId],
    );
    const highWatermark = source ? source.input_high_watermark : highWatermarkRow?.hw ?? null;
    if (highWatermark === null || (!source && highWatermark <= state.reply_cursor)) {
      return null;
    }
    if (mode === 'claim_if_idle' && state.active_run_id !== null) {
      return null;
    }

    const runId = createTurnRunId();
    const revisionAtClaim = state.revision + 1;

    // idx_turn_runs_single_active 保证每会话最多一个 active run：
    // 必须先 supersede 孤儿再插新 run，否则 INSERT 直接违反部分唯一索引。
    if (mode === 'take_over_orphan' && state.active_run_id !== null) {
      const superseded = await transaction.runAsync(
        `UPDATE conversation_turn_runs
         SET status = 'superseded', terminal_at = ?
         WHERE run_id = ? AND status = 'active'`,
        [now, state.active_run_id],
      );
      if (superseded.changes !== 1) {
        throw new ConversationTurnInvariantError(
          `takeOverOrphan：孤儿 run ${state.active_run_id} 期望为 active，实际影响 ${superseded.changes} 行`,
        );
      }
    }

    // 先插 run 行再更新 turn_state，满足 active_run_id 的外键引用顺序（方案 12 节）。
    await transaction.runAsync(
      `INSERT INTO conversation_turn_runs
         (run_id, session_id, kind, reply_cursor_at_claim, input_high_watermark,
          revision_at_claim, status, terminal_reason, created_at, terminal_at, regeneration_source_run_id, input_cursor_at_claim)
       VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?, NULL, ?, ?)`,
      [runId, sessionId, runKind, state.reply_cursor, highWatermark, revisionAtClaim, now,
        source?.run_id ?? null, source ? source.input_cursor_at_claim ?? source.reply_cursor_at_claim : null],
    );

    // CAS 断言：claim_if_idle 额外要求 active_run_id IS NULL（16.3），
    // take_over_orphan 要求 active_run_id 仍是事务内读到的值。
    const claimed = mode === 'claim_if_idle'
      ? await transaction.runAsync(
        `UPDATE conversation_turn_state
         SET active_run_id = ?, active_run_kind = ?, revision = revision + 1, updated_at = ?
         WHERE session_id = ? AND revision = ? AND active_run_id IS NULL`,
        [runId, runKind, now, sessionId, state.revision],
      )
      : await transaction.runAsync(
        `UPDATE conversation_turn_state
         SET active_run_id = ?, active_run_kind = ?, revision = revision + 1, updated_at = ?
         WHERE session_id = ? AND revision = ?
           AND (active_run_id IS NULL OR active_run_id = ?)`,
        [runId, runKind, now, sessionId, state.revision, state.active_run_id],
      );
    if (claimed.changes !== 1) {
      throw new ConversationTurnInvariantError(
        `claim：turn_state CAS 影响 ${claimed.changes} 行（session ${sessionId}，expected revision ${state.revision}）`,
      );
    }

    await transaction.runAsync('DELETE FROM chat_regeneration_requests WHERE session_id = ?', [sessionId]);
    return {
      runId,
      sessionId,
      kind: runKind,
      regenerationSourceRunId: source?.run_id ?? null,
      inputCursorAtClaim: source ? source.input_cursor_at_claim ?? source.reply_cursor_at_claim : null,
      replyCursorAtClaim: state.reply_cursor,
      inputHighWatermark: highWatermark,
      revisionAtClaim,
      status: 'active',
      terminalReason: null,
      createdAt: now,
      terminalAt: null,
    };
  }

  async listOpenToolPackageIds(sessionId: string, assistantId: string): Promise<string[]> {
    return databaseCoordinator.read(
      { name: 'chat.open-tool-packages', feature: 'chat', priority: 'interactive' },
      async (executor) => {
        const rows = await executor.getAllAsync<{ package_id: string }>(
          `SELECT package_id FROM chat_tool_package_exposure
           WHERE session_id = ? AND assistant_id = ? ORDER BY package_id`,
          [sessionId, assistantId],
        );
        return rows.map((row) => row.package_id);
      },
    );
  }

  async commitTurn(
    run: ConversationTurnRun,
    items: ConversationTurnCommitItem[],
    toolPackages: ConversationToolPackageCommit,
  ): Promise<ConversationTurnCommitResult> {
    if (items.length === 0) {
      throw new ConversationTurnInvariantError(`commitTurn：run ${run.runId} 不允许空条目列表`);
    }
    return databaseCoordinator.transaction(
      { name: 'chat.commit-turn', feature: 'chat', priority: 'interactive' },
      async (transaction) => {
        const now = new Date().toISOString();
        // fence 先行：此时事务尚未写入任何事实，失败即原样提交（零变更）。
        const fence = await transaction.runAsync(
          `UPDATE conversation_turn_state
           SET reply_cursor = ?, active_run_id = NULL, active_run_kind = NULL,
               revision = revision + 1, updated_at = ?
           WHERE session_id = ?
             AND reply_cursor = ?
             AND revision = ?
             AND active_run_id = ?`,
          [
            run.inputHighWatermark,
            now,
            run.sessionId,
            run.replyCursorAtClaim,
            run.revisionAtClaim,
            run.runId,
          ],
        );
        if (fence.changes === 0) {
          return { outcome: 'fence_failed' };
        }

        let mediaAssetCandidates: string[] = [];
        if (run.regenerationSourceRunId) {
          const old = await transaction.getAllAsync<{ id: number }>(
            `SELECT id FROM messages WHERE turn_run_id = ? AND turn_item_index IS NOT NULL
             ORDER BY turn_item_index`, [run.regenerationSourceRunId],
          );
          // 业务卡片的 turn_item_index 为 NULL，保留其已发生的事实。
          const removed = await messageRepository.deleteMessagesWithMediaCandidatesInTransaction(transaction, old.map((row) => row.id));
          mediaAssetCandidates = [...removed.mediaAssetCandidates];
          // 旧 run 已无 canonical 成员；保留的业务卡片应恢复自身真实时间排序。
          await transaction.runAsync(
            'DELETE FROM chat_timeline_run_anchors WHERE session_id = ? AND turn_run_id = ?',
            [run.sessionId, run.regenerationSourceRunId],
          );
        }
        const messages = [];
        for (const [index, item] of items.entries()) {
          const materialized = item.materializeInTransaction
            ? await item.materializeInTransaction(transaction, item.message)
            : item.message;
          messages.push({
            ...materialized,
            turnRunId: run.runId,
            turnItemIndex: index + 1,
          });
        }
        // Agent timeline 已在 application 边界完成顺序转换；工具/系统/推理展示项
        // 可以和 assistant 一起写入同一 T3，但 session preview 只能来自最后一条
        // assistant 可见消息。没有 assistant 可见消息时保留原 preview。
        const lastAssistantMessage = [...messages]
          .reverse()
          .find((message) => message.senderType === 'assistant');
        const previewText = lastAssistantMessage
          ? buildSessionPreviewTextFromMessage(lastAssistantMessage)
          : null;
        const inserted = await messageRepository.commitMessagesInTransaction(transaction, {
          messages,
          previewText,
        });

        if (messages.some((message) => message.senderType === 'assistant')) {
          // 只有成功提交正式回复才推进轮数；同事务里的 fence 失败和回滚不会消耗有效期。
          const scope = [run.sessionId, toolPackages.assistantId];
          await transaction.runAsync(
            `DELETE FROM chat_tool_package_exposure
             WHERE session_id = ? AND assistant_id = ? AND remaining_turns = 1`, scope,
          );
          await transaction.runAsync(
            `UPDATE chat_tool_package_exposure SET remaining_turns = remaining_turns - 1
             WHERE session_id = ? AND assistant_id = ?`, scope,
          );
          for (const packageId of new Set(toolPackages.openedPackageIds)) {
            await transaction.runAsync(
              `INSERT INTO chat_tool_package_exposure (session_id, assistant_id, package_id, remaining_turns)
               VALUES (?, ?, ?, 3)
               ON CONFLICT(session_id, assistant_id, package_id) DO UPDATE SET remaining_turns = 3`,
              [...scope, packageId],
            );
          }
        }

        const terminal = await transaction.runAsync(
          `UPDATE conversation_turn_runs
           SET status = 'committed', terminal_at = ?
           WHERE run_id = ? AND status = 'active'`,
          [now, run.runId],
        );
        if (terminal.changes !== 1) {
          throw new ConversationTurnInvariantError(
            `commitTurn：run ${run.runId} 期望为 active，实际影响 ${terminal.changes} 行`,
          );
        }
        return {
          outcome: 'committed',
          messageIds: inserted.map((message) => message.id),
          messages: inserted,
          mediaAssetCandidates,
        };
      },
    );
  }

  async revoke(
    run: ConversationTurnRun,
    status: ConversationTurnTerminalStatus,
    reason: string,
  ): Promise<void> {
    return databaseCoordinator.transaction(
      { name: 'chat.revoke-turn', feature: 'chat', priority: 'interactive' },
      async (transaction) => {
        const now = new Date().toISOString();
        const revoked = await transaction.runAsync(
          `UPDATE conversation_turn_state
           SET active_run_id = NULL, active_run_kind = NULL,
               revision = revision + 1, updated_at = ?
           WHERE session_id = ? AND revision = ? AND active_run_id = ?`,
          [now, run.sessionId, run.revisionAtClaim, run.runId],
        );
        const terminal = await transaction.runAsync(
          `UPDATE conversation_turn_runs
           SET status = ?, terminal_reason = ?, terminal_at = ?
           WHERE run_id = ? AND status = 'active'`,
          [status, reason, now, run.runId],
        );
        // turn_state CAS 0 行：run 已被 supersede/commit 失去所有权，
        // 不重试 turn_state，只尽力写 run 行终态；
        // 但所有权已撤销而 run 行却不是 active 属于状态漂移，必须回滚并报 invariant violation。
        if (revoked.changes === 1 && terminal.changes !== 1) {
          throw new ConversationTurnInvariantError(
            `revoke：run ${run.runId} 所有权已撤销但 run 行非 active（影响 ${terminal.changes} 行）`,
          );
        }
      },
    );
  }

  async findTerminalRunCovering(
    sessionId: string,
    highWatermark: number,
  ): Promise<ConversationTurnRun | null> {
    return databaseCoordinator.read(
      { name: 'chat.find-terminal-run-covering', feature: 'chat', priority: 'runtime' },
      async (db) => {
        const row = await db.getFirstAsync<TurnRunRow>(
          `SELECT * FROM conversation_turn_runs
           WHERE session_id = ?
             AND kind = 'user_reply' AND status IN ('failed', 'cancelled')
             AND input_high_watermark >= ?
           ORDER BY input_high_watermark DESC
           LIMIT 1`,
          [sessionId, highWatermark],
        );
        return row ? mapRowToRun(row) : null;
      },
    );
  }

  async getSessionTurnSnapshot(
    sessionId: string,
  ): Promise<ConversationTurnUnrepliedSession | null> {
    return databaseCoordinator.read(
      { name: 'chat.get-session-turn-snapshot', feature: 'chat', priority: 'runtime' },
      async (db) => {
        const row = await db.getFirstAsync<{ reply_cursor: number; high_watermark: number | null; has_regeneration: number }>(
          `SELECT s.reply_cursor,
                  (s.active_run_kind IS 'regenerate' OR EXISTS (
                    SELECT 1 FROM chat_regeneration_requests q WHERE q.session_id = s.session_id)) AS has_regeneration,
                  (SELECT MAX(m.id) FROM messages m
                   WHERE m.session_id = s.session_id
                     AND m.is_me = 1
                     AND json_extract(m.metadata_json, '$.type') IS NOT 'callStatus') AS high_watermark
           FROM conversation_turn_state s
           WHERE s.session_id = ?`,
          [sessionId],
        );
        if (!row || row.high_watermark === null) {
          return null;
        }
        return {
          sessionId,
          replyCursor: row.reply_cursor,
          highWatermark: Number(row.high_watermark),
          ...(row.has_regeneration ? { hasRegeneration: true } : {}),
        };
      },
    );
  }

  async listSessionsWithUnrepliedInput(
    afterSessionId: string,
    limit: number,
  ): Promise<ConversationTurnUnrepliedSession[]> {
    return databaseCoordinator.read(
      { name: 'chat.list-sessions-with-unreplied-input', feature: 'chat', priority: 'runtime' },
      async (db) => {
        const rows = await db.getAllAsync<{ session_id: string; reply_cursor: number; high_watermark: number; has_regeneration: number }>(
          `SELECT s.session_id, s.reply_cursor,
                  (s.active_run_kind IS 'regenerate' OR EXISTS (
                    SELECT 1 FROM chat_regeneration_requests q WHERE q.session_id = s.session_id)) AS has_regeneration,
                  (SELECT MAX(m2.id) FROM messages m2
                   WHERE m2.session_id = s.session_id
                     AND m2.is_me = 1
                     AND json_extract(m2.metadata_json, '$.type') IS NOT 'callStatus') AS high_watermark
           FROM conversation_turn_state s
           INNER JOIN chat_conversations c
             ON c.id = s.session_id AND c.kind = 'direct'
           WHERE s.session_id > ?
             AND (EXISTS (SELECT 1 FROM chat_regeneration_requests q WHERE q.session_id = s.session_id)
               OR s.active_run_kind = 'regenerate' OR EXISTS (
               SELECT 1 FROM messages m
               WHERE m.session_id = s.session_id
                 AND m.is_me = 1
                 AND json_extract(m.metadata_json, '$.type') IS NOT 'callStatus'
                 AND m.id > s.reply_cursor
             ))
           ORDER BY s.session_id ASC
           LIMIT ?`,
          [afterSessionId, limit],
        );
        return rows.map((row) => ({
          sessionId: row.session_id,
          replyCursor: row.reply_cursor,
          highWatermark: Number(row.high_watermark ?? 0),
          ...(row.has_regeneration ? { hasRegeneration: true } : {}),
        }));
      },
    );
  }
}

export const conversationTurnRepository = new ConversationTurnRepository();
