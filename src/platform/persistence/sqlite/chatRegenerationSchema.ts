/** 重写请求复用回合 owner；原输入区间与提交游标分别保存，禁止回退回复游标。 */
import type { DatabaseWriteExecutor } from '../runtime';

export const CHAT_REGENERATION_REQUESTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS chat_regeneration_requests (
    session_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
    source_run_id TEXT NOT NULL REFERENCES conversation_turn_runs(run_id),
    revision INTEGER NOT NULL
  );
`;

export async function migrateChatRegeneration(db: DatabaseWriteExecutor): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('conversation_turn_runs')");
  if (!columns.some((column) => column.name === 'regeneration_source_run_id')) {
    await db.execAsync('ALTER TABLE conversation_turn_runs ADD COLUMN regeneration_source_run_id TEXT');
  }
  if (!columns.some((column) => column.name === 'input_cursor_at_claim')) {
    await db.execAsync('ALTER TABLE conversation_turn_runs ADD COLUMN input_cursor_at_claim INTEGER');
  }
  await db.execAsync(CHAT_REGENERATION_REQUESTS_SCHEMA);
}
