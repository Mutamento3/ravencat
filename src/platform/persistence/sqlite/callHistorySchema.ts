/** 历史展示与 AI 上下文事实分开删除；音频和可选截图统一交给 MediaAsset 管理。 */
export const CALL_HISTORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS call_history (
    call_id TEXT PRIMARY KEY REFERENCES call_sessions(id) ON DELETE CASCADE,
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    UNIQUE (assistant_id, title)
  );
  CREATE TABLE IF NOT EXISTS call_history_entries (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    call_id TEXT NOT NULL REFERENCES call_history(call_id) ON DELETE CASCADE,
    speaker TEXT NOT NULL CHECK (speaker IN ('user', 'ai')),
    input_kind TEXT NOT NULL CHECK (input_kind IN ('text', 'speech')),
    text TEXT NOT NULL,
    media_asset_id TEXT REFERENCES media_assets(id),
    duration_ms REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_call_history_entries_call ON call_history_entries(call_id, sequence);
  CREATE INDEX IF NOT EXISTS idx_call_history_entries_media ON call_history_entries(media_asset_id);
  CREATE TABLE IF NOT EXISTS call_history_preferences (
    assistant_id TEXT PRIMARY KEY REFERENCES ai_assistants(id) ON DELETE CASCADE,
    save_snapshots INTEGER NOT NULL DEFAULT 0 CHECK (save_snapshots IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS call_history_images (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL REFERENCES call_history(call_id) ON DELETE CASCADE,
    media_asset_id TEXT NOT NULL REFERENCES media_assets(id),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_call_history_images_call ON call_history_images(call_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_call_history_images_media ON call_history_images(media_asset_id);
`;
