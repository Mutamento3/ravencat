/** 协议空间只保存用户与 AI 可编辑的常驻提示词，不再保存优先级和有效期。 */
import type { DatabaseWriteExecutor } from '../runtime';

export const PROTOCOL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS protocols (
    id TEXT PRIMARY KEY,
    ai_assistant_id TEXT NOT NULL,
    content TEXT NOT NULL,
    summary TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (ai_assistant_id) REFERENCES ai_assistants(id) ON DELETE CASCADE
  );
`;

/** 所有旧条目原样保留；契约升级与旧提示词引用转换必须一起提交。 */
export async function migrateProtocolPermanentInjection(db: DatabaseWriteExecutor): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version!.user_version >= 102) return;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('protocols')");
    if (columns.some((column) => column.name === 'priority')) {
      await db.execAsync(`
        DROP INDEX IF EXISTS idx_protocols_priority;
        ALTER TABLE protocols DROP COLUMN priority;
        ALTER TABLE protocols DROP COLUMN effective_date;
        ALTER TABLE protocols DROP COLUMN expiry_date;
      `);
    }
    await db.execAsync(`
      UPDATE prompt_preset_items SET definition_id = 'context.protocol_space', enabled = 1
        WHERE definition_id = 'context.high_priority_protocols';
      DELETE FROM assistant_prompt_definition_states
        WHERE definition_id = 'context.high_priority_protocols';
      DELETE FROM assistant_prompt_definition_overrides
        WHERE definition_id = 'context.high_priority_protocols';
      DELETE FROM prompt_default_overrides
        WHERE definition_id = 'context.high_priority_protocols';
      PRAGMA user_version = 102;
    `);
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}
