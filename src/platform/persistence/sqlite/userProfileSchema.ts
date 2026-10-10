import type { DatabaseWriteExecutor } from '../runtime';

/** 恢复的旧库与新安装都建立同一资料契约，不回填用户未声明的身份。 */
export async function migrateUserProfilePersona(db: DatabaseWriteExecutor): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info('user_profile')");
  const names = new Set(columns.map((column) => column.name));
  const definitions = [
    ['gender', "TEXT NOT NULL DEFAULT ''"],
    ['age', "INTEGER CHECK (age IS NULL OR (typeof(age) = 'integer' AND age >= 0))"],
    ['identity', "TEXT NOT NULL DEFAULT ''"],
    ['region', "TEXT NOT NULL DEFAULT ''"],
    ['other', "TEXT NOT NULL DEFAULT ''"],
    ['signature', "TEXT NOT NULL DEFAULT ''"],
  ];
  const missing = definitions.filter(([name]) => !names.has(name));
  if (missing.length === 0) return;
  await db.execAsync('BEGIN IMMEDIATE');
  try {
    for (const [name, definition] of missing) {
      await db.execAsync(`ALTER TABLE user_profile ADD COLUMN ${name} ${definition}`);
    }
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}
