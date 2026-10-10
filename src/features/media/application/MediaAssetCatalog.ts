import type { DatabaseTransactionExecutor } from '@platform/persistence';

import type { MediaAsset } from '../domain/MediaAsset';
import type { MediaAssetRepository } from '../domain/MediaAssetRepository';
import { MediaAssetBackingNotFoundError, type MediaAssetBackingRegistry } from './MediaAssetBacking';

export interface MediaAssetReuseSnapshot {
  available: readonly MediaAsset[];
  missing: readonly MediaAsset[];
}

export interface SelectOrCreateMediaAssetResult {
  asset: MediaAsset;
  reused: boolean;
}

/**
 * 同一个 backing locator 已经代表另一份内容或非 ready 资产时，迁移不能覆盖旧身份。
 * 这通常表示历史文件被替换或旧 catalog 已经损坏，应由 migration owner 记录并停止本次消息。
 */
export class MediaAssetLocatorConflictError extends Error {
  constructor(
    readonly existing: MediaAsset,
    readonly incoming: MediaAsset,
  ) {
    super(
      `MediaAsset locator metadata/status 冲突：${incoming.storageBackend}/${incoming.storageKey}`,
    );
    this.name = 'MediaAssetLocatorConflictError';
  }
}

/** 拥有复用裁决；文件检查在事务外完成，catalog 与业务引用在同一事务内提交。 */
export class MediaAssetCatalog {
  constructor(private readonly repository: MediaAssetRepository) {}

  getById(id: string): Promise<MediaAsset | null> {
    return this.repository.getById(id);
  }

  /** 文件是外部边界；复用候选的可用性在事务外确认，事务内只裁决仍存在的同一 locator。 */
  async inspectReuseCandidates(asset: MediaAsset, backings: MediaAssetBackingRegistry): Promise<MediaAssetReuseSnapshot> {
    const candidates = await this.repository.listHashCandidates(asset);
    const available: MediaAsset[] = [];
    const missing: MediaAsset[] = [];
    for (const candidate of candidates) {
      if (candidate.storageBackend !== asset.storageBackend || candidate.status !== 'ready'
        || candidate.byteSize !== asset.byteSize || candidate.mimeType !== asset.mimeType) continue;
      try {
        await backings.requireResolver(candidate.storageBackend).resolve(candidate.storageKey);
        available.push(candidate);
      } catch (error) {
        if (!(error instanceof MediaAssetBackingNotFoundError)) throw error;
        missing.push(candidate);
      }
    }
    return { available, missing };
  }

  /**
   * 将一份已经存在于 backing 的文件登记为资产。
   *
   * 先按 locator 查身份，再按同 backend 的内容 metadata 复用；两个查询都在调用方
   * 的同一事务内完成，保证一个 batch 不会为相同 locator 产生第二个 asset row。
   */
  async adoptExistingInTransaction(
    transaction: DatabaseTransactionExecutor,
    asset: MediaAsset,
    reuse: MediaAssetReuseSnapshot,
  ): Promise<SelectOrCreateMediaAssetResult> {
    const existing = await this.repository.getByStorageLocatorInTransaction(transaction, {
      storageBackend: asset.storageBackend,
      storageKey: asset.storageKey,
    });

    if (existing) {
      if (
        existing.status !== 'ready'
        || existing.hashAlgorithm !== asset.hashAlgorithm
        || existing.contentHash !== asset.contentHash
        || existing.byteSize !== asset.byteSize
        || existing.mimeType !== asset.mimeType
      ) {
        throw new MediaAssetLocatorConflictError(existing, asset);
      }

      return { asset: existing, reused: true };
    }

    return this.selectOrCreateInTransaction(transaction, asset, reuse);
  }

  async selectOrCreateInTransaction(
    transaction: DatabaseTransactionExecutor,
    asset: MediaAsset,
    reuse: MediaAssetReuseSnapshot,
  ): Promise<SelectOrCreateMediaAssetResult> {
    const candidates = await this.repository.listHashCandidatesInTransaction(transaction, {
      hashAlgorithm: asset.hashAlgorithm,
      contentHash: asset.contentHash,
    });
    for (const candidate of candidates) {
      if (candidate.status === 'ready' && reuse.missing.some((checked) => (
        checked.id === candidate.id && checked.storageKey === candidate.storageKey
        && checked.storageBackend === candidate.storageBackend
      ))) {
        await this.repository.updateStatusInTransaction(transaction, {
          id: candidate.id, status: 'missing', updatedAt: asset.updatedAt,
        });
      }
    }
    const reusable = candidates.find((candidate) => (
      candidate.storageBackend === asset.storageBackend
      && candidate.status === 'ready'
      && candidate.byteSize === asset.byteSize
      && candidate.mimeType === asset.mimeType
      && reuse.available.some((checked) => checked.id === candidate.id
        && checked.storageKey === candidate.storageKey && checked.storageBackend === candidate.storageBackend)
    ));

    if (reusable) {
      return { asset: reusable, reused: true };
    }

    await this.repository.createInTransaction(transaction, asset);
    return { asset, reused: false };
  }
}
