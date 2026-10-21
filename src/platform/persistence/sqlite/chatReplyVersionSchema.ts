/** 候选版本独立存档；只有采用版本物化到普通消息时间线。 */
export const CHAT_REPLY_VERSIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_reply_version_sets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    current_run_id TEXT NOT NULL UNIQUE REFERENCES conversation_turn_runs(run_id),
    selected_version_id TEXT NOT NULL,
    locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_reply_version_session ON chat_reply_version_sets(session_id);
  CREATE TABLE IF NOT EXISTS chat_reply_versions (
    id TEXT PRIMARY KEY,
    set_id TEXT NOT NULL REFERENCES chat_reply_version_sets(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
  );
  CREATE INDEX IF NOT EXISTS idx_chat_reply_version_set ON chat_reply_versions(set_id, created_at);
`;
