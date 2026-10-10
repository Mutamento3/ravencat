/** 应用外观选择属于 Profile；URI 列只用于本机升级期间保留尚未迁移的来源。 */
import type { DatabaseTransactionExecutor } from '@platform/persistence';

export interface WallpaperAssetSelection {
  key: string;
  mediaAssetId: string | null;
  legacyUri: string | null;
  revision: number;
}

export interface WallpaperRepository {
  list(): Promise<WallpaperAssetSelection[]>;
  seed(transaction: DatabaseTransactionExecutor, selections: readonly { key: string; uri: string | null }[]): Promise<void>;
  commit(transaction: DatabaseTransactionExecutor, expected: WallpaperAssetSelection | { key: string; revision: null }, assetId: string | null): Promise<void>;
  removeConversation(transaction: DatabaseTransactionExecutor, key: string): Promise<string | null>;
}
