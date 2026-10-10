import type {
  CoordinatedDatabaseExecutor,
  DatabaseTransactionExecutor,
} from '@platform/persistence';

import type { MediaAsset } from '../domain/MediaAsset';
import type {
  MediaAssetBackingRegistry,
  MediaAssetBackingWriter,
  PreparedMediaAssetBacking,
} from './MediaAssetBacking';
import type { MediaAssetCatalog, MediaAssetReuseSnapshot } from './MediaAssetCatalog';

export interface MediaAssetContentMetadata {
  contentHash: string;
  byteSize: number;
}

export interface MediaAssetContentInspector {
  inspect(localUri: string): Promise<MediaAssetContentMetadata>;
}

export interface CreateMediaAssetInput {
  storageBackend: string;
  sourceUri: string;
  fileName?: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface CommitMediaAssetReferenceInput {
  transaction: DatabaseTransactionExecutor;
  asset: MediaAsset;
}

export interface CreateMediaAssetResult<T> {
  asset: MediaAsset;
  reused: boolean;
  value: T;
}

export interface CreateMediaAssetDependencies {
  catalog: MediaAssetCatalog;
  backings: MediaAssetBackingRegistry;
  contentInspector: MediaAssetContentInspector;
  database: Pick<CoordinatedDatabaseExecutor, 'withExclusiveTransactionAsync'>;
  generateId: () => string;
  now: () => string;
  reportPostCommitCleanupFailure: (error: unknown, prepared: PreparedMediaAssetBacking) => void;
}

export type MediaAssetPreparationDependencies = Pick<
  CreateMediaAssetDependencies,
  'catalog' | 'backings' | 'contentInspector' | 'generateId' | 'now'
>;

export interface PreparedMediaAssetDraft {
  asset: MediaAsset;
  prepared: PreparedMediaAssetBacking;
  writer: MediaAssetBackingWriter;
  reuse: MediaAssetReuseSnapshot;
}

export async function prepareMediaAssetDraft(
  dependencies: MediaAssetPreparationDependencies,
  input: CreateMediaAssetInput,
): Promise<PreparedMediaAssetDraft> {
  const writer = dependencies.backings.requireWriter(input.storageBackend);
  const id = dependencies.generateId();
  const prepared = await writer.prepare({
    assetId: id,
    sourceUri: input.sourceUri,
    fileName: input.fileName,
  });
  try {
    const content = await dependencies.contentInspector.inspect(prepared.localUri);
    const timestamp = dependencies.now();
    const asset: MediaAsset = {
      id, storageBackend: prepared.storageBackend, storageKey: prepared.storageKey,
      hashAlgorithm: 'sha256', contentHash: content.contentHash, mimeType: input.mimeType,
      byteSize: content.byteSize, width: input.width, height: input.height,
      durationMs: input.durationMs, status: 'ready', createdAt: timestamp, updatedAt: timestamp,
    };
    const reuse = await dependencies.catalog.inspectReuseCandidates(asset, dependencies.backings);
    return {
      writer,
      prepared,
      asset,
      reuse,
    };
  } catch (error) {
    try {
      await writer.delete(prepared.storageKey);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'MediaAsset 准备失败且补偿删除失败');
    }
    throw error;
  }
}

/**
 * 文件先在事务外准备并计算最终 metadata；资产行与业务引用必须在同一事务提交。
 * 本 use case 不提供 ownerless catalog create，避免 M2 引入没有真实引用的新资产。
 */
export class CreateMediaAsset {
  constructor(private readonly dependencies: CreateMediaAssetDependencies) {}

  async execute<T>(
    input: CreateMediaAssetInput,
    commitReference: (input: CommitMediaAssetReferenceInput) => Promise<T>,
  ): Promise<CreateMediaAssetResult<T>> {
    let draft: PreparedMediaAssetDraft | null = null;

    try {
      draft = await prepareMediaAssetDraft(this.dependencies, input);

      const committed = await this.dependencies.database.withExclusiveTransactionAsync(
        async (transaction) => {
          const selected = await this.dependencies.catalog.selectOrCreateInTransaction(
            transaction,
            draft!.asset,
            draft!.reuse,
          );
          const value = await commitReference({ transaction, asset: selected.asset });
          return { ...selected, value };
        },
      );

      if (committed.reused) {
        await this.discardAfterCommit(draft.writer, draft.prepared);
      } else {
        draft.writer.commitPrepared(draft.prepared.storageKey);
      }
      return committed;
    } catch (error) {
      if (draft) {
        await this.compensateOrThrow(draft.writer, draft.prepared, error);
      }
      throw error;
    }
  }

  private async compensateOrThrow(
    writer: MediaAssetBackingWriter,
    prepared: PreparedMediaAssetBacking,
    originalError: unknown,
  ): Promise<void> {
    try {
      await writer.delete(prepared.storageKey);
    } catch (cleanupError) {
      throw new AggregateError(
        [originalError, cleanupError],
        `MediaAsset 创建失败且补偿删除失败：${prepared.storageBackend}/${prepared.storageKey}`,
      );
    }
  }

  private async discardAfterCommit(
    writer: MediaAssetBackingWriter,
    prepared: PreparedMediaAssetBacking,
  ): Promise<void> {
    try {
      await writer.delete(prepared.storageKey);
    } catch (error) {
      // 业务事务已经提交，不能把 orphan 清理失败伪装成业务失败；M5 会负责 reconciliation。
      this.dependencies.reportPostCommitCleanupFailure(error, prepared);
    }
  }
}
