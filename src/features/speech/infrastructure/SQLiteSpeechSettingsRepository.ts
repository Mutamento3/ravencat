import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import type { SpeechSettingsRepository } from '../domain/SpeechSettingsRepository';

export const speechSettingsRepository: SpeechSettingsRepository = {
  async getRecognitionModelId() {
    const db = databaseCoordinator.openTaskExecutor({ name: 'speech.settings.read', feature: 'speech', priority: 'runtime' });
    const row = await db.getFirstAsync<{ model_config_id: string | null }>('SELECT model_config_id FROM speech_recognition_settings WHERE id = 1');
    return row!.model_config_id;
  },
  async setRecognitionModelId(modelConfigId) {
    const db = databaseCoordinator.openTaskExecutor({ name: 'speech.settings.write', feature: 'speech', priority: 'runtime' });
    await db.runAsync('UPDATE speech_recognition_settings SET model_config_id = ? WHERE id = 1', [modelConfigId]);
  },
};

export async function initializeSpeechRecognitionModelInTransaction(transaction: DatabaseTransactionExecutor, modelConfigId: string): Promise<void> {
  await transaction.runAsync('UPDATE speech_recognition_settings SET model_config_id = ? WHERE id = 1 AND model_config_id IS NULL', [modelConfigId]);
}
