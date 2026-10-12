/** 收藏是独立快照，不对原消息、会话或角色建立级联外键。 */
export const CHAT_FAVORITES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_favorites (
    id TEXT PRIMARY KEY NOT NULL,
    source_message_id INTEGER NOT NULL UNIQUE,
    category TEXT NOT NULL CHECK (category IN ('text', 'audio', 'image', 'file')),
    saved_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
  );
`;
export const CHAT_FAVORITES_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_chat_favorites_saved ON chat_favorites(saved_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_chat_favorites_category_saved ON chat_favorites(category, saved_at DESC, id DESC);
`;
