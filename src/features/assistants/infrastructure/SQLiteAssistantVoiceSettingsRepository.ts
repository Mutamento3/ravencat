import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { AssistantVoiceSettingsRepository } from '../domain/AssistantVoiceSettingsRepository';

export const assistantVoiceSettingsRepository: AssistantVoiceSettingsRepository = {
  async getModelId(assistantId) {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.voice.read', feature: 'assistants', priority: 'runtime' });
    const row = await db.getFirstAsync<{ model_config_id: string | null }>('SELECT model_config_id FROM assistant_voice_settings WHERE assistant_id = ?', [assistantId]);
    return row?.model_config_id ?? null;
  },
  async setModelId(assistantId, modelConfigId) {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.voice.write', feature: 'assistants', priority: 'runtime' });
    await db.runAsync(`INSERT INTO assistant_voice_settings (assistant_id, model_config_id) VALUES (?, ?)
      ON CONFLICT(assistant_id) DO UPDATE SET model_config_id = excluded.model_config_id`, [assistantId, modelConfigId]);
  },
};

/** 显式选择和取消都有持久行，不能被首次初始化覆盖。 */
export async function initializeAssistantVoiceModelInTransaction(transaction: DatabaseTransactionExecutor, modelConfigId: string, assistantId: string | null = null): Promise<void> {
  await transaction.runAsync(`INSERT OR IGNORE INTO assistant_voice_settings (assistant_id, model_config_id)
    SELECT id, ? FROM ai_assistants WHERE (? IS NULL OR id = ?)`, [modelConfigId, assistantId, assistantId]);
}
