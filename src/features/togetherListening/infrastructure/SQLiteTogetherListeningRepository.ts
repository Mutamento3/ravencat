/** Together Listening 产品真值的 SQLite 适配器。 */

import { databaseCoordinator } from '@platform/persistence';
import {
  TOGETHER_LISTENING_NON_TERMINAL_PHASES,
  type TogetherListeningActivity,
} from '../domain/TogetherListeningActivity';
import type {
  CreateTogetherListeningActivityResult,
  ITogetherListeningRepository,
  TogetherListeningTransitionPatch,
} from '../domain/TogetherListeningRepository';

interface TogetherListeningActivityRow {
  id: string;
  host_ai_id: string;
  chat_session_id: string;
  initiator: string;
  phase: string;
  created_at_epoch_ms: number;
  updated_at_epoch_ms: number;
  activated_at_epoch_ms: number | null;
  ended_at_epoch_ms: number | null;
  end_reason: string | null;
}

const NON_TERMINAL_PLACEHOLDERS = TOGETHER_LISTENING_NON_TERMINAL_PHASES
  .map(() => '?')
  .join(', ');

export class SQLiteTogetherListeningRepository implements ITogetherListeningRepository {
  async createIfNoCurrent(
    activity: TogetherListeningActivity,
  ): Promise<CreateTogetherListeningActivityResult> {
    const database = databaseCoordinator.openTaskExecutor({
      name: 'togetherListening.createIfNoCurrent',
      feature: 'togetherListening',
      priority: 'interactive',
    });

    return database.withExclusiveTransactionAsync(async (transaction) => {
      const currentRow = await transaction.getFirstAsync<TogetherListeningActivityRow>(
        `SELECT * FROM together_listening_activities
         WHERE phase IN (${NON_TERMINAL_PLACEHOLDERS})
         ORDER BY created_at_epoch_ms DESC
         LIMIT 1`,
        [...TOGETHER_LISTENING_NON_TERMINAL_PHASES],
      );
      if (currentRow) {
        return {
          outcome: 'non_terminal_activity_exists',
          activity: this.mapRow(currentRow),
        };
      }

      await transaction.runAsync(
        `INSERT INTO together_listening_activities (
           id, host_ai_id, chat_session_id, initiator, phase,
           created_at_epoch_ms, updated_at_epoch_ms, activated_at_epoch_ms,
           ended_at_epoch_ms, end_reason
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          activity.id,
          activity.hostAiId,
          activity.chatSessionId,
          activity.initiator,
          activity.phase,
          activity.createdAtEpochMs,
          activity.updatedAtEpochMs,
          activity.activatedAtEpochMs,
          activity.endedAtEpochMs,
          activity.endReason,
        ],
      );
      return { outcome: 'created', activity };
    });
  }

  async getById(id: string): Promise<TogetherListeningActivity | null> {
    const database = databaseCoordinator.openTaskExecutor({
      name: 'togetherListening.getById',
      feature: 'togetherListening',
      priority: 'interactive',
    });
    const row = await database.getFirstAsync<TogetherListeningActivityRow>(
      'SELECT * FROM together_listening_activities WHERE id = ?',
      [id],
    );
    return row ? this.mapRow(row) : null;
  }

  async getCurrent(): Promise<TogetherListeningActivity | null> {
    const database = databaseCoordinator.openTaskExecutor({
      name: 'togetherListening.getCurrent',
      feature: 'togetherListening',
      priority: 'interactive',
    });
    const row = await database.getFirstAsync<TogetherListeningActivityRow>(
      `SELECT * FROM together_listening_activities
       WHERE phase IN (${NON_TERMINAL_PLACEHOLDERS})
       ORDER BY created_at_epoch_ms DESC
       LIMIT 1`,
      [...TOGETHER_LISTENING_NON_TERMINAL_PHASES],
    );
    return row ? this.mapRow(row) : null;
  }

  async transitionActivityIfPhase(
    id: string,
    expectedPhases: Parameters<ITogetherListeningRepository['transitionActivityIfPhase']>[1],
    patch: TogetherListeningTransitionPatch,
  ): Promise<TogetherListeningActivity | null> {
    const database = databaseCoordinator.openTaskExecutor({
      name: 'togetherListening.transitionActivityIfPhase',
      feature: 'togetherListening',
      priority: 'interactive',
    });
    const fields = ['phase = ?', 'updated_at_epoch_ms = ?'];
    const values: (string | number | null)[] = [patch.phase, patch.updatedAtEpochMs];

    if (patch.activatedAtEpochMs !== undefined) {
      fields.push('activated_at_epoch_ms = ?');
      values.push(patch.activatedAtEpochMs);
    }
    if (patch.endedAtEpochMs !== undefined) {
      fields.push('ended_at_epoch_ms = ?');
      values.push(patch.endedAtEpochMs);
    }
    if (patch.endReason !== undefined) {
      fields.push('end_reason = ?');
      values.push(patch.endReason);
    }

    values.push(id, ...expectedPhases);
    return database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE together_listening_activities
         SET ${fields.join(', ')}
         WHERE id = ? AND phase IN (${expectedPhases.map(() => '?').join(', ')})`,
        values,
      );
      if (result.changes === 0) {
        return null;
      }
      const row = await transaction.getFirstAsync<TogetherListeningActivityRow>(
        'SELECT * FROM together_listening_activities WHERE id = ?',
        [id],
      );
      if (!row) {
        throw new Error(`Together Listening Activity ${id} 在状态转换后不存在`);
      }
      return this.mapRow(row);
    });
  }

  private mapRow(row: TogetherListeningActivityRow): TogetherListeningActivity {
    return {
      id: row.id,
      hostAiId: row.host_ai_id,
      chatSessionId: row.chat_session_id,
      initiator: row.initiator as TogetherListeningActivity['initiator'],
      phase: row.phase as TogetherListeningActivity['phase'],
      createdAtEpochMs: row.created_at_epoch_ms,
      updatedAtEpochMs: row.updated_at_epoch_ms,
      activatedAtEpochMs: row.activated_at_epoch_ms,
      endedAtEpochMs: row.ended_at_epoch_ms,
      endReason: row.end_reason as TogetherListeningActivity['endReason'],
    };
  }
}

export const togetherListeningRepository = new SQLiteTogetherListeningRepository();
