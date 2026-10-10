/** 新翻译资产与旧退休 translate 类型隔离；旧实际使用的服务一次性成为明确选择。 */
import type { DatabaseWriteExecutor } from '../runtime';

export const TRANSLATION_SELECTION_SCHEMA = `
CREATE TABLE IF NOT EXISTS translation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1), model_config_id TEXT
);
INSERT OR IGNORE INTO translation_settings (id) VALUES (1);
`;

interface LegacyTranslationRow {
  id: string; provider: string; name: string; credentials_json: string; options_json: string | null;
  enabled: number; created_at: string; updated_at: string;
}
function readObject(json: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('旧翻译配置不是 JSON 对象');
  return parsed as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export async function migrateTranslationModels(db: DatabaseWriteExecutor): Promise<void> {
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version!.user_version >= 106) return;
  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    await db.execAsync(TRANSLATION_SELECTION_SCHEMA);
    const table = await db.getFirstAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'external_service_configs'");
    if (table) {
      const rows = await db.getAllAsync<LegacyTranslationRow>("SELECT * FROM external_service_configs WHERE kind = 'translate' ORDER BY updated_at DESC");
      for (const row of rows) {
        const credentials = readObject(row.credentials_json);
        const options = row.options_json ? readObject(row.options_json) : {};
        if (row.provider !== 'aiModel' && row.provider !== 'tencentCloudTmt') throw new Error(`旧翻译提供方无法迁移：${row.provider}`);
        const ai = row.provider === 'aiModel';
        // 旧客户端对不能解析的项目 ID 使用 0，迁移固定它原来的调用值。
        const projectId = typeof options.projectId === 'string' || typeof options.projectId === 'number' ? Number(options.projectId) : 0;
        const metadata = {
          provider: row.provider, source: text(options.source) || 'auto', target: text(options.target) || 'zh',
          ...(!ai ? { secretId: text(credentials.secretId), region: text(options.region) || 'ap-guangzhou', projectId: Number.isFinite(projectId) ? projectId : 0 } : {}),
        };
        await db.runAsync(`INSERT INTO auxiliary_model_configs (
          id, capability_kind, name, base_url, api_key, model, temperature, top_p, max_tokens,
          enabled, metadata_json, created_at, updated_at
        ) VALUES (?, 'translation', ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`, [
          `translation_${row.id}`, row.name,
          ai ? text(options.baseURL) : `https://${text(options.endpoint) || 'tmt.tencentcloudapi.com'}`,
          ai ? text(credentials.apiKey) : text(credentials.secretKey), ai ? text(options.model) : 'TextTranslate',
          row.enabled, JSON.stringify(metadata), row.created_at, row.updated_at,
        ]);
      }
      const selected = rows.find((row) => row.enabled === 1);
      if (selected) await db.runAsync('UPDATE translation_settings SET model_config_id = ? WHERE id = 1', [`translation_${selected.id}`]);
      // 只退休已经转换的翻译行；其他历史服务数据不属于本次迁移。
      await db.runAsync("DELETE FROM external_service_configs WHERE kind = 'translate'");
      const remaining = await db.getFirstAsync<{ id: string }>('SELECT id FROM external_service_configs LIMIT 1');
      if (!remaining) await db.execAsync('DROP TABLE external_service_configs;');
    }
    await db.execAsync('PRAGMA user_version = 106; COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
