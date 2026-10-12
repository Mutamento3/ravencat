import type { DatabaseTransactionExecutor } from '@platform/persistence';

export interface AIDownloadedImageRepository {
  addInTransaction(transaction: DatabaseTransactionExecutor, input: {
    assistantId: string; mediaAssetId: string; sourceUrl: string; fileName: string;
  }): Promise<void>;
}
