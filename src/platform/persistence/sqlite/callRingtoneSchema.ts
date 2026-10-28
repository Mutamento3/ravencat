/** 每个角色分别选择来电铃声和拨出等待音；恢复默认也保留 revision，避免旧选择覆盖。 */
export const CALL_RINGTONE_SELECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS call_ringtone_selection (
    assistant_id TEXT NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
    media_asset_id TEXT,
    file_name TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY (assistant_id, direction),
    CHECK ((media_asset_id IS NULL) = (file_name IS NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_call_ringtone_media ON call_ringtone_selection(media_asset_id);
`;
