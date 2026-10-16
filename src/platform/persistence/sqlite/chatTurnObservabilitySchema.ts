/** 已发布数据库按实际列结构升级；运行状态不会改变主 revision 或回复游标。 */
import type { DatabaseWriteExecutor } from '../runtime';

export async function migrateChatTurnObservability(db: DatabaseWriteExecutor): Promise<void> {
  const additions = {
    conversation_turn_state: [
      ['host_request_revision', 'INTEGER NOT NULL DEFAULT 0'],
      ['host_request_input_id', 'INTEGER'],
      ['host_request_status', 'TEXT'],
      ['host_request_at', 'TEXT'],
    ],
    chat_turn_presentations: [['phase', "TEXT NOT NULL DEFAULT 'preparing'"], ['phase_at', 'TEXT']],
  };
  for (const [table, columns] of Object.entries(additions)) {
    const existing = new Set((await db.getAllAsync<{ name: string }>(`PRAGMA table_info('${table}')`)).map(row => row.name));
    for (const [name, type] of columns) if (!existing.has(name)) await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`);
  }
}
