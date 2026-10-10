/** Calls 的角色背景选择；行不存在表示该角色使用默认背景。 */
import type { DatabaseTransactionExecutor } from '@platform/persistence';

export interface CallBackgroundSelection {
  mediaAssetId: string | null;
  revision: number;
}

export interface CallBackgroundRepository {
  get(assistantId: string): Promise<CallBackgroundSelection | null>;
  commit(transaction: DatabaseTransactionExecutor, assistantId: string, expectedRevision: number | null, mediaAssetId: string | null): Promise<CallBackgroundSelection>;
  getLegacyMigration(): Promise<{ hasUnassignedRoles: boolean } | null>;
  completeLegacyMigration(transaction: DatabaseTransactionExecutor, mediaAssetId: string | null): Promise<void>;
}
