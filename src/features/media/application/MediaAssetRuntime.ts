import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

import type {
  CommitMediaAssetReferenceInput,
  CreateMediaAsset,
  CreateMediaAssetInput,
  CreateMediaAssetResult,
} from './CreateMediaAsset';
import type {
  AdoptExistingMediaAssetInput,
  AdoptExistingMediaAssets,
  AdoptExistingMediaAssetsResult,
  CommitAdoptedMediaAssetReferenceInput,
} from './AdoptExistingMediaAssets';
import type { MediaAssetCatalog } from './MediaAssetCatalog';
import type { MediaAssetResolver, ResolvedMediaAsset } from './MediaAssetResolver';
import type { PrepareMediaAssetBatch, PreparedMediaAssetBatch } from './PreparedMediaAssetBatch';
import type {
  MediaAssetCleanupResult,
  MediaAssetClosureAudit,
  MediaAssetLifecycle,
} from './MediaAssetLifecycle';

export interface MediaAssetRuntimeDependencies {
  catalog: MediaAssetCatalog;
  creator: CreateMediaAsset;
  adopter: AdoptExistingMediaAssets;
  resolver: MediaAssetResolver;
  preparer: PrepareMediaAssetBatch;
  lifecycle: MediaAssetLifecycle;
}

const mediaAssetRuntimeSlot = createRuntimeSlot<MediaAssetRuntimeDependencies>('MediaAsset');

export function configureMediaAssetRuntime(dependencies: MediaAssetRuntimeDependencies): void {
  mediaAssetRuntimeSlot.configure(dependencies);
}

export function getMediaAsset(assetId: string) {
  return mediaAssetRuntimeSlot.get().catalog.getById(assetId);
}

export function createMediaAssetWithReference<T>(
  input: CreateMediaAssetInput,
  commitReference: (input: CommitMediaAssetReferenceInput) => Promise<T>,
): Promise<CreateMediaAssetResult<T>> {
  return mediaAssetRuntimeSlot.get().creator.execute(input, commitReference);
}

/** Host-only 的 legacy migration 能力；稳定 Feature 出口不暴露此方法。 */
export function adoptExistingMediaAssetsWithReference<T>(
  inputs: readonly AdoptExistingMediaAssetInput[],
  commitReference: (
    input: CommitAdoptedMediaAssetReferenceInput,
  ) => Promise<T>,
): Promise<AdoptExistingMediaAssetsResult<T>> {
  return mediaAssetRuntimeSlot.get().adopter.execute(inputs, commitReference);
}

export function resolveMediaAsset(assetId: string): Promise<ResolvedMediaAsset> {
  return mediaAssetRuntimeSlot.get().resolver.resolve(assetId);
}

export function prepareMediaAssetBatch(
  inputs: readonly CreateMediaAssetInput[],
): Promise<PreparedMediaAssetBatch> {
  return mediaAssetRuntimeSlot.get().preparer.execute(inputs);
}

export function auditMediaAssetClosure(): Promise<MediaAssetClosureAudit> {
  return mediaAssetRuntimeSlot.get().lifecycle.audit();
}

export function cleanupMediaAssetOrphans(): Promise<MediaAssetCleanupResult> {
  return mediaAssetRuntimeSlot.get().lifecycle.cleanup();
}

/**
 * 业务事实提交后的媒体释放入口。
 *
 * 调用方只需要给出「本次变更可能让哪些 asset 失去最后一个引用」的候选 asset id：引用裁决
 * 仍然覆盖全部引用来源，但不做全库枚举，因此普通交互路径不再为一次删除付完整 GC 成本。
 *
 * 清理失败不能把已经成功的业务删除伪装成业务失败，因此这里只诊断。全库 audit / cleanup
 * 仍然保留，供维护、显式修复与开发验证使用。
 */
export async function releaseMediaAssetCandidates(
  assetIds: readonly (string | null | undefined)[],
): Promise<void> {
  try {
    const result = await mediaAssetRuntimeSlot.get().lifecycle.releaseCandidates(assetIds);
    if (result.failures.length > 0) {
      console.warn('[MediaAsset] 候选资产释放后的 backing 清理未完整完成：', result.failures);
    }
  } catch (error) {
    console.warn('[MediaAsset] 候选资产释放失败：', error);
  }
}

/**
 * 级联删除中的候选收集：调用方传入删除事务自己的 executor，让「收集候选 + 删除事实」
 * 共享同一个 exclusive transaction。事务外先收集会让窗口期内新提交的角色背景漏出候选集。
 */
export function collectAssistantMediaAssetCandidatesInTransaction(transaction: DatabaseTransactionExecutor, assistantId: string): Promise<readonly string[]> {
  return mediaAssetRuntimeSlot.get().lifecycle.collectAssistantMediaAssetCandidates(assistantId, transaction);
}

/** 消息候选与删除事实共享事务，覆盖级联删除窗口中的新媒体引用。 */
export function collectChatSessionMediaAssetCandidatesInTransaction(
  transaction: DatabaseTransactionExecutor,
  sessionIds: readonly string[],
): Promise<readonly string[]> {
  return mediaAssetRuntimeSlot
    .get()
    .lifecycle
    .collectChatSessionMediaAssetCandidates(sessionIds, transaction);
}

export interface MediaAssetReferenceUriInput {
  mediaAssetId: string | null;
  legacyUri: string | null;
}

/**
 * 显式解析迁移期的互斥引用。asset ID 存在时必须以 catalog 为事实源，
 * 解析失败直接暴露，不回退到 legacy URI。
 */
export async function resolveMediaAssetReferenceUri(
  input: MediaAssetReferenceUriInput,
): Promise<string | null> {
  if (input.mediaAssetId) {
    return (await resolveMediaAsset(input.mediaAssetId)).localUri;
  }

  const legacyUri = input.legacyUri?.trim() ?? '';
  return legacyUri || null;
}
