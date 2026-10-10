/** 使用 SQLite 持久化本地伴随正式设置。 */

import { databaseCoordinator } from '@platform/persistence';
import {
  createCompanionSettings,
  createCompanionSettingsFromRow,
  COMPANION_SETTINGS_ID,
  type CompanionSettings,
  type CompanionSettingsRow,
  type UpdateCompanionSettingsInput,
} from '../domain/CompanionSettings';
import type { CompanionSettingsRepository } from '../domain/CompanionRepositories';

export class SQLiteCompanionSettingsRepository
  implements CompanionSettingsRepository {
  async get(): Promise<CompanionSettings | null> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.settings.get', feature: 'companion', priority: 'surface' });
    const row = await db.getFirstAsync<CompanionSettingsRow>(
      `SELECT id, quiet_hours_enabled,
              quiet_hours_start_minutes, quiet_hours_end_minutes,
              user_screen_capture_blacklist_json,
              created_at, updated_at
       FROM raven_cat_contact_settings WHERE id = ? LIMIT 1`,
      [COMPANION_SETTINGS_ID]
    );
    return createCompanionSettingsFromRow(row);
  }

  async ensureDefault(): Promise<CompanionSettings> {
    const existing = await this.get();
    if (existing) return existing;

    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.settings.ensureDefault', feature: 'companion', priority: 'surface' });
    const settings = createCompanionSettings();
    await db.runAsync(
      `INSERT OR IGNORE INTO raven_cat_contact_settings (
         id, quiet_hours_enabled,
         quiet_hours_start_minutes, quiet_hours_end_minutes,
         user_screen_capture_blacklist_json,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        settings.id,
        settings.quietHoursEnabled ? 1 : 0,
        settings.quietHoursStartMinutes,
        settings.quietHoursEndMinutes,
        JSON.stringify(settings.userScreenCaptureBlacklist),
        settings.createdAt,
        settings.updatedAt,
      ]
    );
    const persisted = await this.get();
    if (!persisted) {
      throw new Error('RavenCat 本地伴随设置初始化失败');
    }
    return persisted;
  }

  async update(
    updates: UpdateCompanionSettingsInput
  ): Promise<CompanionSettings> {
    const existing = await this.ensureDefault();
    const next = createCompanionSettings({
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    const db = databaseCoordinator.openTaskExecutor({ name: 'companion.settings.update', feature: 'companion', priority: 'surface' });
    await db.runAsync(
      `UPDATE raven_cat_contact_settings
       SET quiet_hours_enabled = ?,
           quiet_hours_start_minutes = ?, quiet_hours_end_minutes = ?,
           user_screen_capture_blacklist_json = ?,
           updated_at = ?
       WHERE id = ?`,
      [
        next.quietHoursEnabled ? 1 : 0,
        next.quietHoursStartMinutes,
        next.quietHoursEndMinutes,
        JSON.stringify(next.userScreenCaptureBlacklist),
        next.updatedAt,
        next.id,
      ]
    );
    return next;
  }
}

export const companionSettingsRepository =
  new SQLiteCompanionSettingsRepository();
