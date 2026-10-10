/** 使用 SQLite 持久化悬浮交互的独立用户意图。 */

import { databaseCoordinator } from '@platform/persistence';
import {
  createFloatingInteractionSettings,
  createFloatingInteractionSettingsFromRow,
  FLOATING_INTERACTION_SETTINGS_ID,
  type FloatingInteractionSettings,
  type FloatingInteractionSettingsRow,
} from '../domain/FloatingInteractionSettings';
import type { IFloatingInteractionSettingsRepository } from '../domain/FloatingInteractionSettingsRepository';

export class SQLiteFloatingInteractionSettingsRepository
  implements IFloatingInteractionSettingsRepository {
  async get(): Promise<FloatingInteractionSettings | null> {
    const db = databaseCoordinator.openTaskExecutor({
      name: 'floatingLayer.floatingInteractionSettings.get',
      feature: 'floatingLayer',
      priority: 'surface',
    });
    const row = await db.getFirstAsync<FloatingInteractionSettingsRow>(
      `SELECT id, enabled, created_at, updated_at
       FROM raven_cat_floating_interaction_settings
       WHERE id = ? LIMIT 1`,
      [FLOATING_INTERACTION_SETTINGS_ID],
    );
    return createFloatingInteractionSettingsFromRow(row);
  }

  async ensureDefault(): Promise<FloatingInteractionSettings> {
    const existing = await this.get();
    if (existing) return existing;

    const settings = createFloatingInteractionSettings();
    const db = databaseCoordinator.openTaskExecutor({
      name: 'floatingLayer.floatingInteractionSettings.ensureDefault',
      feature: 'floatingLayer',
      priority: 'surface',
    });
    await db.runAsync(
      `INSERT OR IGNORE INTO raven_cat_floating_interaction_settings (
         id, enabled, created_at, updated_at
       ) VALUES (?, ?, ?, ?)`,
      [settings.id, settings.enabled ? 1 : 0, settings.createdAt, settings.updatedAt],
    );
    const persisted = await this.get();
    if (!persisted) {
      throw new Error('RavenCat 悬浮交互设置初始化失败');
    }
    return persisted;
  }

  async setEnabled(enabled: boolean): Promise<FloatingInteractionSettings> {
    const current = await this.ensureDefault();
    const updatedAt = new Date().toISOString();
    const db = databaseCoordinator.openTaskExecutor({
      name: 'floatingLayer.floatingInteractionSettings.setEnabled',
      feature: 'floatingLayer',
      priority: 'surface',
    });
    await db.runAsync(
      `UPDATE raven_cat_floating_interaction_settings
       SET enabled = ?, updated_at = ?
       WHERE id = ?`,
      [enabled ? 1 : 0, updatedAt, current.id],
    );
    return { ...current, enabled, updatedAt };
  }
}

export const floatingInteractionSettingsRepository =
  new SQLiteFloatingInteractionSettingsRepository();
