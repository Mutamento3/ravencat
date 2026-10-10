import type { DatabaseWriteExecutor } from '../runtime';

/** id 是角色 ID；保留已有列名让旧备份的媒体清单无需版本分支。角色删除时绑定级联清除。 */
export const CALL_BACKGROUND_SELECTION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS call_background_selection (
    id TEXT PRIMARY KEY NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE,
    media_asset_id TEXT,
    revision INTEGER NOT NULL CHECK (revision >= 0)
  );
`;

/** SQLite 旧背景直接分配给现有角色；更早的本机文件由 Calls 在事务外迁移。 */
export async function migrateAssistantCallBackgrounds(db: DatabaseWriteExecutor): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version!.user_version >= 100) return;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const columns = await db.getAllAsync<{ name: string; type: string }>("PRAGMA table_info('call_background_selection')");
    let hadGlobalSelection = false;
    if (columns.some((column) => column.name === 'id' && column.type === 'INTEGER')) {
      hadGlobalSelection = await db.getFirstAsync('SELECT 1 FROM call_background_selection WHERE id = 1') !== null;
      await db.execAsync('ALTER TABLE call_background_selection RENAME TO call_background_global_selection');
      await db.execAsync(CALL_BACKGROUND_SELECTION_SCHEMA);
      await db.execAsync(`
        INSERT INTO call_background_selection (id, media_asset_id, revision)
        SELECT assistant.id, selection.media_asset_id, selection.revision
        FROM ai_assistants assistant CROSS JOIN call_background_global_selection selection;
        DROP TABLE call_background_global_selection;
      `);
    }
    if (!hadGlobalSelection) {
      // 固化升级时的角色集合；首次读取前新建的角色也不能继承旧全局背景。
      await db.execAsync(`
        CREATE TABLE call_background_legacy_migration (
          assistant_id TEXT PRIMARY KEY NOT NULL REFERENCES ai_assistants(id) ON DELETE CASCADE
        );
        INSERT INTO call_background_legacy_migration SELECT id FROM ai_assistants;
      `);
    }
    await db.execAsync('PRAGMA user_version = 100; COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}

/** 修正开发版100已落盘的角色键列名；保留角色绑定、资产身份、revision 与外键。 */
export async function migrateCallBackgroundRoleKey(db: DatabaseWriteExecutor): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version!.user_version >= 101) return;

  await db.execAsync('BEGIN IMMEDIATE');
  try {
    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('call_background_selection')");
    if (columns.some((column) => column.name === 'assistant_id')) {
      await db.execAsync('ALTER TABLE call_background_selection RENAME COLUMN assistant_id TO id');
    }
    await db.execAsync('PRAGMA user_version = 101; COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}
