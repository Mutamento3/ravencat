import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { createRandomUUID } from '@platform/device';
import type { AIDownloadedImageRepository } from '../domain/AIDownloadedImageRepository';

export class SQLiteAIDownloadedImageRepository implements AIDownloadedImageRepository {
  async addInTransaction(transaction: DatabaseTransactionExecutor, input: {
    assistantId: string; mediaAssetId: string; sourceUrl: string; fileName: string;
  }): Promise<void> {
    await transaction.runAsync(`INSERT INTO ai_downloaded_images
      (id, assistant_id, media_asset_id, source_url, file_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [createRandomUUID(), input.assistantId, input.mediaAssetId, input.sourceUrl, input.fileName, new Date().toISOString()]);
  }
}
