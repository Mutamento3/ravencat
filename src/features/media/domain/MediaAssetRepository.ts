import type { DatabaseTransactionExecutor } from '@platform/persistence';

import type {
  MediaAsset,
  MediaAssetStatus,
  MediaHashAlgorithm,
} from './MediaAsset';

export interface MediaAssetHashCandidateQuery {
  hashAlgorithm: MediaHashAlgorithm;
  contentHash: string;
}

export interface MediaAssetStorageLocatorQuery {
  storageBackend: string;
  storageKey: string;
}

export interface UpdateMediaAssetStatusInput {
  id: string;
  status: MediaAssetStatus;
  updatedAt: string;
}

/**
 * MediaAsset catalog 的持久化端口。
 *
 * 写方法只接受调用方已经开启的 transaction，使资产行能与真实业务引用原子提交。
 * 事务内只处理 SQL；文件准备、Hash、补偿删除和 resolver 调用都属于事务外流程。
 */
export interface MediaAssetRepository {
  getById(id: string): Promise<MediaAsset | null>;

  listHashCandidates(query: MediaAssetHashCandidateQuery): Promise<readonly MediaAsset[]>;

  getByStorageLocatorInTransaction(
    transaction: DatabaseTransactionExecutor,
    query: MediaAssetStorageLocatorQuery,
  ): Promise<MediaAsset | null>;

  listHashCandidatesInTransaction(
    transaction: DatabaseTransactionExecutor,
    query: MediaAssetHashCandidateQuery,
  ): Promise<readonly MediaAsset[]>;

  createInTransaction(
    transaction: DatabaseTransactionExecutor,
    asset: MediaAsset,
  ): Promise<void>;

  updateStatusInTransaction(
    transaction: DatabaseTransactionExecutor,
    input: UpdateMediaAssetStatusInput,
  ): Promise<void>;
}
