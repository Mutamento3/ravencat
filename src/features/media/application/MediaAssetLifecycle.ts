import type {
  CoordinatedDatabaseExecutor,
  DatabaseTransactionExecutor,
  DatabaseWriteExecutor,
} from '@platform/persistence';

import type { MediaAsset } from '../domain/MediaAsset';
import type {
  MediaAssetDatabaseAudit,
  MediaAssetLifecycleRepository,
} from '../domain/MediaAssetLifecycle';
import { MediaAssetBackingNotFoundError, type MediaAssetBackingRegistry, type MediaAssetBackingWriter } from './MediaAssetBacking';

export interface MediaAssetPhysicalOrphan {
  storageBackend: string;
  storageKey: string;
}

export interface MediaAssetClosureAudit extends MediaAssetDatabaseAudit {
  physicalOrphans: readonly MediaAssetPhysicalOrphan[];
  unavailableAssets: readonly MediaAsset[];
}

export type MediaAssetCleanupPhase =
  | 'catalog_orphan_file'
  | 'physical_orphan_file'
  | 'released_asset_file';

export interface MediaAssetCleanupFailure {
  storageBackend: string;
  storageKey: string;
  phase: MediaAssetCleanupPhase;
  error: unknown;
}

export interface MediaAssetCleanupResult {
  deletedAssets: readonly MediaAsset[];
  deletedPhysicalOrphans: readonly MediaAssetPhysicalOrphan[];
  /** 因为是只读 backing 或 legacy namespace 而刻意保留、不属于自动回收范围的文件。 */
  retainedUnmanagedFiles: readonly MediaAssetPhysicalOrphan[];
  /** 删除前被重新裁决拦下的 physical orphan（fail-closed 暂停或已经 live）。只报告，不删除。 */
  blockedPhysicalOrphans: readonly MediaAssetPhysicalOrphan[];
  failures: readonly MediaAssetCleanupFailure[];
  audit: MediaAssetClosureAudit;
}

/** targeted release 的结果；只描述候选 asset 自己的释放情况，不做全库裁决。 */
export interface MediaAssetReleaseResult {
  releasedAssets: readonly MediaAsset[];
  deletedBackings: readonly MediaAssetPhysicalOrphan[];
  retainedUnmanagedFiles: readonly MediaAssetPhysicalOrphan[];
  failures: readonly MediaAssetCleanupFailure[];
}

interface MediaAssetBackingDeletionOutcome {
  deleted: MediaAssetPhysicalOrphan[];
  retained: MediaAssetPhysicalOrphan[];
  failures: MediaAssetCleanupFailure[];
}

function locatorKey(storageBackend: string, storageKey: string): string {
  return `${storageBackend}\u0000${storageKey}`;
}

/** 只保留非空候选 asset id；空值/重复值不应变成无意义的数据库裁决。 */
function normalizeCandidateAssetIds(assetIds: readonly (string | null | undefined)[]): string[] {
  const normalized = new Set<string>();
  for (const assetId of assetIds) {
    const trimmed = typeof assetId === 'string' ? assetId.trim() : '';
    if (trimmed) {
      normalized.add(trimmed);
    }
  }
  return [...normalized];
}

function dedupeLocators(
  locators: readonly MediaAssetPhysicalOrphan[],
): MediaAssetPhysicalOrphan[] {
  const seen = new Set<string>();
  const deduped: MediaAssetPhysicalOrphan[] = [];
  for (const locator of locators) {
    const key = locatorKey(locator.storageBackend, locator.storageKey);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(locator);
  }
  return deduped;
}

/**
 * MediaAsset 生命周期唯一 owner。
 *
 * 数据库引用裁决在独占事务内完成；文件 IO 严格发生在 commit 之后。catalog row
 * 先删除、文件后删除，因此文件删除失败只会留下可再次检测的 physical orphan，绝不会
 * 留下指向已删除文件的业务引用或 catalog 行。
 *
 * 两条入口职责不同，不能互相替代：
 *
 * - `releaseCandidates()` 是业务交互路径的 targeted release：只裁决调用方点名的 asset id。
 * - `audit()` / `cleanup()` 是全库诊断与维护入口：枚举全部引用、全部资产与 canonical 目录。
 */
export class MediaAssetLifecycle {
  constructor(
    private readonly repository: MediaAssetLifecycleRepository,
    private readonly backings: MediaAssetBackingRegistry,
    private readonly database: Pick<CoordinatedDatabaseExecutor, 'withExclusiveTransactionAsync'>,
  ) {}

  async audit(): Promise<MediaAssetClosureAudit> {
    // 文件快照必须先于 catalog 快照：prepare 中的文件受 writer in-flight 集合保护而
    // 不会进入快照；若 catalog 恰在两步之间提交，文件仍不在候选集里。反向顺序会让
    // 新提交文件出现在旧 catalog 快照之后，产生误删 live backing 的窗口。
    const physicalLocators: MediaAssetPhysicalOrphan[] = [];

    for (const writer of this.backings.listWriters()) {
      const keys = await writer.listCanonicalStorageKeys();
      for (const storageKey of keys) {
        physicalLocators.push({ storageBackend: writer.storageBackend, storageKey });
      }
    }

    const databaseAudit = await this.repository.auditDatabase();
    const unavailableAssets = await this.inspectUnavailableAssets(databaseAudit.assets);
    const catalogLocators = new Set(
      databaseAudit.assets.map((asset) => locatorKey(asset.storageBackend, asset.storageKey)),
    );
    const physicalOrphans = physicalLocators.filter((physical) => (
      !catalogLocators.has(locatorKey(physical.storageBackend, physical.storageKey))
    ));

    return { ...databaseAudit, physicalOrphans, unavailableAssets };
  }

  /**
   * 业务事实提交后的 targeted release。
   *
   * 候选之外的资产不会被裁决，也不会枚举目录或解析其它消息的 metadata；引用判断仍然
   * 覆盖全部引用来源，共享资产只有最后一个引用消失才会释放。
   */
  async releaseCandidates(
    assetIds: readonly (string | null | undefined)[],
  ): Promise<MediaAssetReleaseResult> {
    const candidates = normalizeCandidateAssetIds(assetIds);
    if (candidates.length === 0) {
      return {
        releasedAssets: [],
        deletedBackings: [],
        retainedUnmanagedFiles: [],
        failures: [],
      };
    }

    const releasedAssets = await this.database.withExclusiveTransactionAsync((transaction) => (
      this.repository.releaseUnreferencedAssetsInTransaction(transaction, candidates)
    ));

    const outcome = await this.deleteAssetBackings(releasedAssets, 'released_asset_file');
    return {
      releasedAssets,
      deletedBackings: outcome.deleted,
      retainedUnmanagedFiles: outcome.retained,
      failures: outcome.failures,
    };
  }

  /**
   * 级联删除前的候选收集：候选来自即将消失的角色事实，必须在删除真正执行之前收集。
   *
   * 调用方必须把「收集 + 删除」放进同一个 exclusive transaction，并把该事务的 executor
   * 传进来。事务外先收集会出现这样的窗口：收集之后、删除之前又有新消息提交了媒体引用，
   * 该引用随本次级联删除一起消失，却从未进入候选集，最终留下长期 orphan。
   */
  collectAssistantMediaAssetCandidates(assistantId: string, transaction: DatabaseTransactionExecutor): Promise<readonly string[]> {
    return this.repository.listAssistantMediaAssetIds(assistantId, transaction);
  }

  /** 调用方将消息候选收集与删除放在同一个事务中，避免遗漏窗口期内新提交的媒体引用。 */
  collectChatSessionMediaAssetCandidates(
    sessionIds: readonly string[],
    executor?: DatabaseWriteExecutor,
  ): Promise<readonly string[]> {
    return this.repository.listChatSessionMediaAssetIds(sessionIds, executor);
  }

  async cleanup(): Promise<MediaAssetCleanupResult> {
    const beforeCleanup = await this.repository.auditDatabase();
    const unavailableAssets = await this.inspectUnavailableAssets(beforeCleanup.assets);
    const deletedAssets = await this.database.withExclusiveTransactionAsync((transaction) => (
      this.reconcileAndDeleteOrphans(transaction, unavailableAssets)
    ));

    const catalogOutcome = await this.deleteAssetBackings(deletedAssets, 'catalog_orphan_file');
    const failedLocators = new Set(
      catalogOutcome.failures.map((failure) => locatorKey(
        failure.storageBackend,
        failure.storageKey,
      )),
    );

    const afterCatalogCleanup = await this.audit();
    const deletedPhysicalOrphans: MediaAssetPhysicalOrphan[] = [];
    const blockedPhysicalOrphans: MediaAssetPhysicalOrphan[] = [];
    const retainedPhysicalFiles: MediaAssetPhysicalOrphan[] = [];
    const physicalFailures: MediaAssetCleanupFailure[] = [];

    // fail-closed：dangling reference 表示业务引用指向已经丢失的 catalog 行。此时「没有
    // catalog 行」不能证明文件真的没有业务引用，删除可能把「引用还在 + backing 还在 +
    // row 丢了」这种本可修复的状态彻底破坏。只报告，不删除。
    const physicalOrphanDeletionSuspended = afterCatalogCleanup.danglingReferences.length > 0;

    for (const orphan of afterCatalogCleanup.physicalOrphans) {
      if (physicalOrphanDeletionSuspended) {
        blockedPhysicalOrphans.push(orphan);
        continue;
      }
      if (failedLocators.has(locatorKey(orphan.storageBackend, orphan.storageKey))) {
        continue;
      }

      const writer = this.backings.findWriter(orphan.storageBackend);
      if (!writer || !writer.ownsStorageKeyLifecycle(orphan.storageKey)) {
        retainedPhysicalFiles.push(orphan);
        continue;
      }
      if (await this.isPhysicalOrphanTakenOver(orphan, writer)) {
        blockedPhysicalOrphans.push(orphan);
        continue;
      }

      try {
        await writer.delete(orphan.storageKey);
        deletedPhysicalOrphans.push(orphan);
      } catch (error) {
        physicalFailures.push({ ...orphan, phase: 'physical_orphan_file', error });
      }
    }

    return {
      deletedAssets,
      deletedPhysicalOrphans,
      retainedUnmanagedFiles: dedupeLocators([
        ...catalogOutcome.retained,
        ...retainedPhysicalFiles,
      ]),
      blockedPhysicalOrphans,
      failures: [...catalogOutcome.failures, ...physicalFailures],
      audit: await this.audit(),
    };
  }

  private async reconcileAndDeleteOrphans(transaction: DatabaseTransactionExecutor, unavailable: readonly MediaAsset[]): Promise<readonly MediaAsset[]> {
    await this.repository.markMissingAssetsInTransaction(transaction, unavailable);
    return this.repository.deleteOrphanAssetsInTransaction(transaction);
  }

  private async inspectUnavailableAssets(assets: readonly MediaAsset[]): Promise<MediaAsset[]> {
    const unavailable: MediaAsset[] = [];
    for (const asset of assets) {
      try {
        await this.backings.requireResolver(asset.storageBackend).resolve(asset.storageKey);
      } catch (error) {
        if (!(error instanceof MediaAssetBackingNotFoundError)) throw error;
        unavailable.push(asset);
      }
    }
    return unavailable;
  }

  /**
   * audit 快照可能已经过期，真正删除前必须用当前事实重新裁决。
   *
   * 两种 stale 情况都必须拦下来：期间有 prepare reserve 了同一个 key（文件已有新主人但
   * catalog 行还没提交），或者期间有 asset 提交并接管了这个 locator。
   */
  private async isPhysicalOrphanTakenOver(
    orphan: MediaAssetPhysicalOrphan,
    writer: MediaAssetBackingWriter,
  ): Promise<boolean> {
    if (writer.isStorageKeyInFlight(orphan.storageKey)) {
      return true;
    }
    return this.repository.hasAssetAtLocator(orphan);
  }

  private async deleteAssetBackings(
    assets: readonly MediaAsset[],
    phase: MediaAssetCleanupPhase,
  ): Promise<MediaAssetBackingDeletionOutcome> {
    const deleted: MediaAssetPhysicalOrphan[] = [];
    const retained: MediaAssetPhysicalOrphan[] = [];
    const failures: MediaAssetCleanupFailure[] = [];

    for (const asset of assets) {
      const locator = { storageBackend: asset.storageBackend, storageKey: asset.storageKey };
      const writer = this.backings.findWriter(asset.storageBackend);
      if (!writer || !writer.ownsStorageKeyLifecycle(asset.storageKey)) {
        // 只读 backing，或仍可能有裸 URI consumer 的 legacy namespace，不属于自动回收范围。
        retained.push(locator);
        continue;
      }
      try {
        await writer.delete(asset.storageKey);
        deleted.push(locator);
      } catch (error) {
        failures.push({ ...locator, phase, error });
      }
    }

    return { deleted, retained, failures };
  }
}
