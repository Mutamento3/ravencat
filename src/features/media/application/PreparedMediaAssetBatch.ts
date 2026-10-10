import type { DatabaseTransactionExecutor } from '@platform/persistence';

import type { MediaAsset } from '../domain/MediaAsset';
import type { MediaAssetCatalog } from './MediaAssetCatalog';
import {
  prepareMediaAssetDraft,
  type CreateMediaAssetInput,
  type MediaAssetPreparationDependencies,
  type PreparedMediaAssetDraft,
} from './CreateMediaAsset';

export interface PreparedMediaAssetBatchCommitEntry {
  asset: MediaAsset;
  reused: boolean;
}

export interface PreparedMediaAssetBatchCommitResult {
  entries: readonly PreparedMediaAssetBatchCommitEntry[];
  assets: readonly MediaAsset[];
}

/**
 * batch 的生命周期只由调用方声明的“事务最终结果”推进，不由 batch 自己猜测：
 *
 * - open             尚未进入 catalog 事务；此时丢弃一定安全。
 * - staged           已在事务内写入 catalog 行，但事务最终结果尚未声明。
 * - committed       调用方已声明事务提交成功，只剩下复用 entry 的清理。
 * - finalized       提交后清理完成，不再持有任何待处理的 backing。
 * - discarded       调用方已声明事务未提交，且全部 backing 已删除。
 *
 * 关键不变量：staged 是唯一“事务结果未知”的状态，此时删除任何 backing 都可能删掉
 * 已提交 MediaAsset 正在使用的文件（reused=false 时 catalog 行就指向这次准备的 key）。
 * 因此 staged 之后只接受两个显式方法声明结果，绝不接受含糊的删除。
 */
type PreparedMediaAssetBatchState =
  | 'open'
  | 'staged'
  | 'committed'
  | 'finalized'
  | 'discarded';

/**
 * 准备阶段产生的 backing 由这个对象持有，直到事务提交或回滚路径明确结束。
 * commitInTransaction 只执行 catalog SQL；文件清理只能在事务边界外发生。
 */
export class PreparedMediaAssetBatch {
  private state: PreparedMediaAssetBatchState = 'open';
  private committedEntries: readonly PreparedMediaAssetBatchCommitEntry[] | null = null;
  private readonly deletedEntryIndexes = new Set<number>();

  constructor(
    private readonly catalog: MediaAssetCatalog,
    private readonly entries: readonly PreparedMediaAssetDraft[],
  ) {}

  get size(): number {
    return this.entries.length;
  }

  async commitInTransaction(
    transaction: DatabaseTransactionExecutor,
  ): Promise<PreparedMediaAssetBatchCommitResult> {
    if (this.state !== 'open' || this.committedEntries) {
      throw new Error('PreparedMediaAssetBatch 只能提交一次，且必须处于 open 状态');
    }

    const committedEntries: PreparedMediaAssetBatchCommitEntry[] = [];
    for (const entry of this.entries) {
      const selected = await this.catalog.selectOrCreateInTransaction(
        transaction,
        entry.asset,
        // 同一 batch 中刚写入的资产来自仍受 reservation 保护的已准备文件。
        { available: [...entry.reuse.available, ...committedEntries.map((selected) => selected.asset)], missing: entry.reuse.missing },
      );
      committedEntries.push(selected);
    }

    this.committedEntries = committedEntries;
    // 进入 staged：catalog 行已经写入，但事务可能提交也可能回滚，此时不允许删除任何 backing。
    this.state = 'staged';
    return {
      entries: committedEntries,
      assets: committedEntries.map((entry) => entry.asset),
    };
  }

  /**
   * 外层事务成功后调用。只有 catalog 复用了既有 asset 的 entry 才能删除新准备的 backing。
   * 删除失败时保留 committed 状态，后续重复调用只重试尚未删除的 entry。
   */
  async finalizeAfterCommit(): Promise<void> {
    if (this.state === 'finalized') {
      return;
    }
    if (this.state === 'discarded') {
      throw new Error('PreparedMediaAssetBatch 已 discard，不能再 finalize');
    }
    if (this.state === 'open') {
      throw new Error('PreparedMediaAssetBatch 必须先在事务内 commit');
    }
    const committedEntries = this.committedEntries;
    if (!committedEntries) {
      throw new Error('PreparedMediaAssetBatch 缺少事务内提交结果');
    }

    // 调用方已经声明事务提交成功；此后只允许继续重试清理，不再允许回滚语义的删除。
    this.state = 'committed';
    const cleanupErrors: unknown[] = [];
    for (let index = 0; index < this.entries.length; index += 1) {
      const committed = committedEntries[index];
      if (this.deletedEntryIndexes.has(index)) {
        continue;
      }

      const entry = this.entries[index];
      if (!committed.reused) {
        entry.writer.commitPrepared(entry.prepared.storageKey);
        this.deletedEntryIndexes.add(index);
        continue;
      }
      try {
        await entry.writer.delete(entry.prepared.storageKey);
        this.deletedEntryIndexes.add(index);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'MediaAsset prepared backing 提交后清理失败',
      );
    }

    this.state = 'finalized';
  }

  /**
   * 尚未进入 catalog 事务就取消时调用（例如准备阶段自身失败）。此时所有 backing 都
   * 不可能被任何业务事实接管，因而必须全部删除；已经成功删除的 entry 不会重复 IO。
   *
   * 一旦 commitInTransaction 执行过（staged），本方法直接抛错：batch 无法知道事务
   * 最终提交还是回滚，此时删除会删掉已提交 MediaAsset 正在使用的 backing。调用方
   * 必须显式声明事务结果，改用 finalizeAfterCommit() 或 discardAfterRollback()。
   */
  async discard(): Promise<void> {
    if (this.state === 'discarded') {
      return;
    }
    if (this.state !== 'open') {
      throw new Error(
        'PreparedMediaAssetBatch 已进入事务提交阶段，必须显式声明事务结果：'
        + '提交成功用 finalizeAfterCommit()，未提交用 discardAfterRollback()',
      );
    }

    await this.deleteAllEntries();
    this.state = 'discarded';
  }

  /**
   * 调用方已确认外层事务没有提交（回滚、fence 失败或放弃提交）时调用。事务没有留下
   * 任何 catalog 行，因此本次准备的全部 backing 都必须删除。
   */
  async discardAfterRollback(): Promise<void> {
    if (this.state === 'discarded') {
      return;
    }
    if (this.state === 'committed' || this.state === 'finalized') {
      throw new Error('PreparedMediaAssetBatch 已进入提交后阶段，不能按回滚清理');
    }

    await this.deleteAllEntries();
    this.state = 'discarded';
  }

  private async deleteAllEntries(): Promise<void> {
    const cleanupErrors: unknown[] = [];
    for (let index = 0; index < this.entries.length; index += 1) {
      if (this.deletedEntryIndexes.has(index)) {
        continue;
      }

      const entry = this.entries[index];
      try {
        await entry.writer.delete(entry.prepared.storageKey);
        this.deletedEntryIndexes.add(index);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'MediaAsset prepared backing 回滚清理失败',
      );
    }
  }
}

/** Host 装配的准备 use case；每个 backing 都在事务外 prepare/inspect。 */
export class PrepareMediaAssetBatch {
  constructor(private readonly dependencies: MediaAssetPreparationDependencies) {}

  async execute(
    inputs: readonly CreateMediaAssetInput[],
  ): Promise<PreparedMediaAssetBatch> {
    const entries: PreparedMediaAssetDraft[] = [];

    try {
      for (const input of inputs) {
        entries.push(await prepareMediaAssetDraft(this.dependencies, input));
      }
    } catch (error) {
      const preparedBatch = new PreparedMediaAssetBatch(this.dependencies.catalog, entries);
      try {
        await preparedBatch.discard();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'MediaAsset prepared batch 准备失败且回滚清理失败',
        );
      }
      throw error;
    }

    return new PreparedMediaAssetBatch(this.dependencies.catalog, entries);
  }
}
