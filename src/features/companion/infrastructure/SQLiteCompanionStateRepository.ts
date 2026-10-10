/** 使用 SQLite 持久化本地伴随唯一事实状态和迁移标记。 */

import { databaseCoordinator } from '@platform/persistence';
import type {
  CompanionStateRepository,
} from '../domain/CompanionRepositories';
import {
  createCompanionState,
  createCompanionStateFromRow,
  COMPANION_STATE_ID,
  type CompanionState,
  type CompanionStateRow,
  type UpdateCompanionStateInput,
} from '../domain/CompanionState';

export class SQLiteCompanionStateRepository
  implements CompanionStateRepository {
  async get(): Promise<CompanionState | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.state.get', feature: 'companion', priority: 'surface' });
    const row = await db.getFirstAsync<CompanionStateRow>(
      'SELECT * FROM raven_cat_companion_state WHERE id = ? LIMIT 1',
      [COMPANION_STATE_ID]
    );
    return createCompanionStateFromRow(row);
  }

  async ensureDefault(): Promise<CompanionState> {
    const existing = await this.get();
    if (existing) return existing;

    const state = createCompanionState();
    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.state.ensureDefault', feature: 'companion', priority: 'surface' });
    await db.runAsync(
      `INSERT OR IGNORE INTO raven_cat_companion_state (
         id, desired_enabled, activation_status,
         host_ai_id, last_failure_code, last_failure_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      toStateValues(state)
    );
    const persisted = await this.get();
    if (!persisted) {
      throw new Error('RavenCat 本地伴随状态初始化失败');
    }
    return persisted;
  }

  async update(
    updates: UpdateCompanionStateInput
  ): Promise<CompanionState> {
    const existing = await this.ensureDefault();
    const next = createCompanionState({
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.state.update', feature: 'companion', priority: 'surface' });
    await db.runAsync(
      `UPDATE raven_cat_companion_state SET
         desired_enabled = ?, activation_status = ?,
         host_ai_id = ?, last_failure_code = ?, last_failure_at = ?,
         updated_at = ? WHERE id = ?`,
      [
        next.desiredEnabled ? 1 : 0,
        next.activationStatus,
        next.hostAIId,
        next.lastFailureCode,
        next.lastFailureAt,
        next.updatedAt,
        next.id,
      ]
    );
    return next;
  }

}

function toStateValues(state: CompanionState): (string | number | null)[] {
  return [
    state.id,
    state.desiredEnabled ? 1 : 0,
    state.activationStatus,
    state.hostAIId,
    state.lastFailureCode,
    state.lastFailureAt,
    state.createdAt,
    state.updatedAt,
  ];
}

export const companionStateRepository =
  new SQLiteCompanionStateRepository();
