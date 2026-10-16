import type { DatabaseWriteExecutor } from '../runtime';

/** Chat 展示记录独立于 canonical 消息；原始快照与交付事实分别持久化。 */
export const CHAT_TURN_PRESENTATIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_turn_presentations (
    run_id TEXT PRIMARY KEY REFERENCES conversation_turn_runs(run_id) ON DELETE CASCADE,
    session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('open', 'completed', 'interrupted')),
    reason TEXT,
    phase TEXT NOT NULL DEFAULT 'preparing',
    phase_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_turn_presentations_session
    ON chat_turn_presentations(session_id, state);
  CREATE TABLE IF NOT EXISTS chat_turn_display_items (
    run_id TEXT NOT NULL REFERENCES chat_turn_presentations(run_id) ON DELETE CASCADE,
    identity TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    shown_version INTEGER NOT NULL DEFAULT 0,
    shown_json TEXT,
    message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
    PRIMARY KEY (run_id, identity)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_turn_display_message
    ON chat_turn_display_items(message_id) WHERE message_id IS NOT NULL;
  CREATE VIEW IF NOT EXISTS chat_visible_messages AS
    SELECT m.*, p.state AS turn_presentation_state FROM messages m
    LEFT JOIN chat_turn_display_items i ON i.message_id = m.id
    LEFT JOIN chat_turn_presentations p ON p.run_id = i.run_id
    WHERE i.message_id IS NULL OR (i.shown_json IS NOT NULL
      AND json_extract(i.shown_json, '$.text') = m.text);
`;

/** 修复旧版被屏幕回执错误扣留的过程记录；未完成正文和媒体意图不补发。 */
export async function migrateChatTurnPublication(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync(`UPDATE chat_turn_display_items SET shown_version = version, shown_json = snapshot_json
    WHERE json_extract(snapshot_json, '$.kind') IN ('reasoning', 'tool');
    UPDATE chat_turn_display_items SET shown_version = version, shown_json = snapshot_json
    WHERE message_id IS NOT NULL AND run_id IN (SELECT p.run_id FROM chat_turn_presentations p
      JOIN conversation_turn_runs r ON r.run_id = p.run_id
      WHERE r.status = 'committed' AND p.reason IN ('new_input', 'new_input_flush'));
    UPDATE chat_turn_presentations SET state = 'completed', reason = 'new_input_flush'
    WHERE reason = 'new_input' AND run_id IN (SELECT run_id FROM conversation_turn_runs WHERE status = 'committed');
    UPDATE chat_turn_presentations SET state = 'completed'
    WHERE state <> 'completed' AND run_id IN (SELECT run_id FROM conversation_turn_runs WHERE status = 'committed')
      AND NOT EXISTS (SELECT 1 FROM chat_turn_display_items i WHERE i.run_id = chat_turn_presentations.run_id
        AND i.message_id IS NOT NULL AND (i.shown_json IS NULL
          OR json_extract(i.shown_json, '$.text') <> json_extract(i.snapshot_json, '$.text')));`);
}
