import type {
  CoordinatedDatabaseExecutor,
  DatabaseTransactionExecutor,
} from '@platform/persistence';

import type { MediaAsset } from '../domain/MediaAsset';
import type { MediaAssetCatalog, MediaAssetReuseSnapshot } from './MediaAssetCatalog';
import type { MediaAssetBackingRegistry } from './MediaAssetBacking';

export interface AdoptExistingMediaAssetInput {
  /** 已由对应 backing 校验过的 backend-relative locator。 */
  storageBackend: string;
  storageKey: string;
  /** 只用于事务外读取最终持久化字节，不会写入 catalog。 */
  localUri: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface AdoptExistingMediaAssetContentInspector {
  inspect(localUri: string): Promise<{
    contentHash: string;
    byteSize: number;
  }>;
}

export interface AdoptedMediaAssetEntry {
  input: AdoptExistingMediaAssetInput;
  asset: MediaAsset;
  reused: boolean;
}

export interface CommitAdoptedMediaAssetReferenceInput {
  transaction: DatabaseTransactionExecutor;
  /** 与输入数组一一对应；同 locator 或同内容复用时可以重复同一个 asset。 */
  entries: readonly AdoptedMediaAssetEntry[];
  assets: readonly MediaAsset[];
}

export interface AdoptExistingMediaAssetsResult<T> {
  /** 与输入数组一一对应，便于迁移 owner 回写业务引用。 */
  assets: readonly MediaAsset[];
  entries: readonly AdoptedMediaAssetEntry[];
  value: T;
}

export interface AdoptExistingMediaAssetsDependencies {
  catalog: MediaAssetCatalog;
  backings: MediaAssetBackingRegistry;
  contentInspector: AdoptExistingMediaAssetContentInspector;
  database: Pick<CoordinatedDatabaseExecutor, 'withExclusiveTransactionAsync'>;
  generateId: () => string;
  now: () => string;
}

interface PreparedAdoption {
  input: AdoptExistingMediaAssetInput;
  draft: MediaAsset;
  reuse: MediaAssetReuseSnapshot;
}

function locatorKey(storageBackend: string, storageKey: string): string {
  return `${storageBackend}\u0000${storageKey}`;
}

function assertInput(input: AdoptExistingMediaAssetInput): void {
  if (!input.storageBackend.trim() || !input.storageKey.trim()) {
    throw new Error('登记既有 MediaAsset 时必须提供 backend 和 storageKey');
  }
  if (!input.localUri.trim()) {
    throw new Error(`登记既有 MediaAsset 时必须提供可读文件 URI：${input.storageKey}`);
  }
  if (!input.mimeType.trim()) {
    throw new Error(`登记既有 MediaAsset 时必须提供 MIME：${input.storageKey}`);
  }
}

function assertSameLocatorMetadata(existing: MediaAsset, incoming: MediaAsset): void {
  if (
    existing.hashAlgorithm !== incoming.hashAlgorithm
    || existing.contentHash !== incoming.contentHash
    || existing.byteSize !== incoming.byteSize
    || existing.mimeType !== incoming.mimeType
  ) {
    throw new Error(
      `同一 MediaAsset locator 的 metadata 冲突：${incoming.storageBackend}/${incoming.storageKey}`,
    );
  }
}

/**
 * 为已经由 legacy backing 管理的文件建立身份。
 *
 * 文件读取和 SHA-256 计算严格发生在事务外，并按输入顺序串行执行；事务内只做
 * catalog 查询/写入和 owner 的引用提交。因为本流程没有创建文件，所以失败时不做
 * deletion compensation。
 */
export class AdoptExistingMediaAssets {
  constructor(private readonly dependencies: AdoptExistingMediaAssetsDependencies) {}

  async execute<T>(
    inputs: readonly AdoptExistingMediaAssetInput[],
    commitReference: (
      input: CommitAdoptedMediaAssetReferenceInput,
    ) => Promise<T>,
  ): Promise<AdoptExistingMediaAssetsResult<T>> {
    const prepared: PreparedAdoption[] = [];
    const preparedByLocator = new Map<string, PreparedAdoption>();

    for (const input of inputs) {
      assertInput(input);
      const key = locatorKey(input.storageBackend, input.storageKey);
      const existing = preparedByLocator.get(key);

      if (existing) {
        if (existing.input.mimeType !== input.mimeType) {
          throw new Error(
            `同一 MediaAsset locator 的 MIME 冲突：${input.storageBackend}/${input.storageKey}`,
          );
        }
        prepared.push(existing);
        continue;
      }

      // 不把文件 IO 带进 SQLite transaction；循环本身保证多个文件顺序读取和 Hash。
      const content = await this.dependencies.contentInspector.inspect(input.localUri);
      const timestamp = this.dependencies.now();
      const adoption: Omit<PreparedAdoption, 'reuse'> = {
        input,
        draft: {
          id: this.dependencies.generateId(),
          storageBackend: input.storageBackend,
          storageKey: input.storageKey,
          hashAlgorithm: 'sha256',
          contentHash: content.contentHash,
          mimeType: input.mimeType,
          byteSize: content.byteSize,
          width: input.width,
          height: input.height,
          durationMs: input.durationMs,
          status: 'ready',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      };
      const reuse = await this.dependencies.catalog.inspectReuseCandidates(adoption.draft, this.dependencies.backings);
      const entry: PreparedAdoption = { ...adoption, reuse };
      preparedByLocator.set(key, entry);
      prepared.push(entry);
    }

    return this.dependencies.database.withExclusiveTransactionAsync(async (transaction) => {
      const selectedByLocator = new Map<string, AdoptedMediaAssetEntry>();
      const selectedEntries: AdoptedMediaAssetEntry[] = [];

      for (const item of prepared) {
        const key = locatorKey(item.draft.storageBackend, item.draft.storageKey);
        const selected = selectedByLocator.get(key);

        if (selected) {
          assertSameLocatorMetadata(selected.asset, item.draft);
          selectedEntries.push({ ...selected, input: item.input });
          continue;
        }

        const result = await this.dependencies.catalog.adoptExistingInTransaction(
          transaction,
          item.draft,
          { available: [...item.reuse.available, ...selectedEntries.map((entry) => entry.asset)], missing: item.reuse.missing },
        );
        const entry: AdoptedMediaAssetEntry = {
          input: item.input,
          asset: result.asset,
          reused: result.reused,
        };
        selectedByLocator.set(key, entry);
        selectedEntries.push(entry);
      }

      const assets = selectedEntries.map(({ asset }) => asset);
      const value = await commitReference({
        transaction,
        entries: selectedEntries,
        assets,
      });
      return { assets, entries: selectedEntries, value };
    });
  }
}

