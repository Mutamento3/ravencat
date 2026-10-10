import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { TranslationSettingsRepository } from '../domain/TranslationSettingsRepository';

export const translationSettingsRepository: TranslationSettingsRepository = {
  async getModelId() {
    const db = databaseCoordinator.openTaskExecutor({ name: 'integrations.translationSelection.read', feature: 'integrations', priority: 'runtime' });
    const row = await db.getFirstAsync<{ model_config_id: string | null }>('SELECT model_config_id FROM translation_settings WHERE id = 1');
    return row!.model_config_id;
  },
  async setModelId(modelConfigId) {
    const db = databaseCoordinator.openTaskExecutor({ name: 'integrations.translationSelection.write', feature: 'integrations', priority: 'runtime' });
    await db.runAsync('UPDATE translation_settings SET model_config_id = ? WHERE id = 1', [modelConfigId]);
  },
};

export async function initializeTranslationModelInTransaction(transaction: DatabaseTransactionExecutor, modelConfigId: string): Promise<void> {
  await transaction.runAsync('UPDATE translation_settings SET model_config_id = ? WHERE id = 1 AND model_config_id IS NULL', [modelConfigId]);
}
