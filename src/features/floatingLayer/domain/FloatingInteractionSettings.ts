/** 定义悬浮交互独立于主动伴随的持久化用户意图。 */

/** 持久化 id 继续使用 default，避免迁移后丢失既有用户设置。 */
export const FLOATING_INTERACTION_SETTINGS_ID = 'default';

export interface FloatingInteractionSettings {
  id: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FloatingInteractionSettingsRow {
  id: string;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export function createFloatingInteractionSettings(
  data: Partial<FloatingInteractionSettings> = {},
): FloatingInteractionSettings {
  const now = new Date().toISOString();
  return {
    id: data.id ?? FLOATING_INTERACTION_SETTINGS_ID,
    enabled: data.enabled ?? false,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  };
}

export function createFloatingInteractionSettingsFromRow(
  row: FloatingInteractionSettingsRow | null,
): FloatingInteractionSettings | null {
  if (!row) return null;
  if (row.enabled !== 0 && row.enabled !== 1) {
    throw new Error('RavenCat 悬浮交互设置数据损坏');
  }
  return {
    id: row.id,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
