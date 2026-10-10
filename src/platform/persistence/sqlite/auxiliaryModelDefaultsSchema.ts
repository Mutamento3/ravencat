/** 首次模型只用于初始化业务选择；保留删除后的 ID，避免后续资产再次抢占默认。 */
import type { DatabaseWriteExecutor } from '../runtime';

export const AUXILIARY_MODEL_DEFAULTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS auxiliary_model_initial_defaults (
  capability_kind TEXT PRIMARY KEY,
  model_config_id TEXT NOT NULL,
  initialized INTEGER NOT NULL DEFAULT 0 CHECK (initialized IN (0, 1))
);
`;

/** 旧安装保留全部业务选择，只记录供新角色使用的首次资产，不重放初始化。 */
export async function migrateAuxiliaryModelDefaults(db: DatabaseWriteExecutor): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version!.user_version >= 108) return;
  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    await db.execAsync(AUXILIARY_MODEL_DEFAULTS_SCHEMA);
    await db.execAsync(`INSERT OR IGNORE INTO auxiliary_model_initial_defaults (capability_kind, model_config_id, initialized)
      SELECT capability_kind, id, 1 FROM auxiliary_model_configs
      WHERE capability_kind IN ('embedding', 'ocr', 'stt', 'tts', 'translation')
      ORDER BY created_at ASC, id ASC;
      PRAGMA user_version = 108;
      COMMIT;`);
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
