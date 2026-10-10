/** RavenCat 悬浮交互用户意图的 SQLite 结构。 */

export const RAVEN_CAT_FLOATING_INTERACTION_SETTINGS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS raven_cat_floating_interaction_settings (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
