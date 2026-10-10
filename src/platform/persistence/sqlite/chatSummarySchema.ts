/** 摘要是用户记录，只有 conversation 删除级联；消息删除与可见边界不影响它。 */
import type { DatabaseWriteExecutor } from '../runtime';
export const CHAT_SUMMARY_SCHEMA = `
CREATE TABLE IF NOT EXISTS chat_timeline_run_anchors (
  session_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  turn_run_id TEXT NOT NULL,
  id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(session_id, turn_run_id)
);
CREATE TABLE IF NOT EXISTS chat_summary_state (
  conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0,
  processed_cursor TEXT,
  claim_id TEXT,
  claim_to_cursor TEXT,
  claim_expires_at TEXT
);
CREATE TABLE IF NOT EXISTS chat_summary_segments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  content TEXT NOT NULL,
  from_cursor TEXT,
  to_cursor TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER,
  source_start_at TEXT,
  source_end_at TEXT,
  time_zone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(conversation_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_chat_summary_conversation_order ON chat_summary_segments(conversation_id, sequence);
CREATE TABLE IF NOT EXISTS chat_summary_processed_calls (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  call_id TEXT NOT NULL,
  PRIMARY KEY(conversation_id, call_id)
);
CREATE TABLE IF NOT EXISTS chat_summary_call_boundary (
  conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  cleared_at TEXT NOT NULL
);
`;
/** 等历史消息列补齐后再建立 anchor，兼容旧备份的真实 bootstrap 顺序。 */
export async function migrateChatSummary(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync(CHAT_SUMMARY_SCHEMA);
  await db.execAsync(`
INSERT OR IGNORE INTO chat_timeline_run_anchors (session_id, turn_run_id, id, created_at)
  SELECT session_id, turn_run_id, id, created_at FROM messages WHERE turn_run_id IS NOT NULL AND turn_item_index = 1;
CREATE TRIGGER IF NOT EXISTS capture_chat_timeline_run_anchor AFTER INSERT ON messages
  WHEN NEW.turn_run_id IS NOT NULL AND NEW.turn_item_index = 1
  BEGIN
    INSERT OR IGNORE INTO chat_timeline_run_anchors (session_id, turn_run_id, id, created_at)
      VALUES (NEW.session_id, NEW.turn_run_id, NEW.id, NEW.created_at);
  END;
  `);
}

/** 摘要正文独立保存；退休来源关联，不复制孤立旧引用，处理进度与通话原文保持不变。 */
export async function retireChatSummaryCallAssociations(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync('DROP TABLE IF EXISTS chat_summary_call_segments;');
}
