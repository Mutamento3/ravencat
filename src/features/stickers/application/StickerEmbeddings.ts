/**
 * 语义向量索引管道：状态查询、批量建索引、重建。
 *
 * 硬边界：识别成功不等于向量化成功。embedding 失败只让向量保持缺失 / stale，
 * 不修改 annotationStatus；没有向量的 ready Sticker 仍可发送并被 lexical 搜索。
 * 任何网络请求都发生在事务之外，单条向量通过事务 upsert 原子写入。
 */

import {
  buildStickerSemanticText,
  type StickerEmbeddingIndexStatus,
} from '../domain/StickerEmbedding';
import { getStickersRuntimeDependencies } from './StickerRuntime';
import { resolveStickerEmbeddingModel } from './StickerSystemModels';
import { emitStickerEmbeddingPending } from './StickerEmbeddingPendingSignal';

/** 控制维护批次大小，并满足当前向量服务每次最多 10 条文本的请求契约。 */
export const STICKER_EMBEDDING_BATCH_SIZE = 10;

export async function getStickerEmbeddingIndexStatus(): Promise<StickerEmbeddingIndexStatus> {
  const runtime = getStickersRuntimeDependencies();
  const readyStickers = await runtime.repository.countReadyStickers();
  const model = await resolveStickerEmbeddingModel();
  if (!model) {
    // 未配置 / 失效模型时全部 ready Sticker 都没有可用向量，但不阻止使用。
    return { readyStickers, validEmbeddings: 0, pendingEmbeddings: readyStickers };
  }
  const validEmbeddings = await runtime.repository.countValidStickerEmbeddings({
    modelConfigId: model.id,
    modelConfigUpdatedAt: model.updatedAt,
    dimension: null,
  });
  return {
    readyStickers,
    validEmbeddings,
    pendingEmbeddings: Math.max(0, readyStickers - validEmbeddings),
  };
}

export interface GenerateStickerEmbeddingBatchResult {
  /** 本次成功写入向量的数量；模型未配置时为 0。 */
  embeddedCount: number;
}

/**
 * 领取一批 ready 且向量缺失 / stale 的 Sticker，生成并原子写入向量。
 * 模型未配置或失效时静默返回 0，由上层保持待机而不是反复刷错误。
 * embedding 请求失败时抛出错误但不触碰 annotationStatus；worker 可以后续重试。
 */
export async function generateStickerEmbeddingBatch(
  input: { batchSize?: number; signal?: AbortSignal } = {},
): Promise<GenerateStickerEmbeddingBatchResult> {
  const runtime = getStickersRuntimeDependencies();
  const batchSize = Math.max(1, Math.floor(input.batchSize ?? STICKER_EMBEDDING_BATCH_SIZE));
  const model = await resolveStickerEmbeddingModel();
  if (!model) return { embeddedCount: 0 };

  const stickers = await runtime.repository.listReadyStickersNeedingEmbedding(
    { modelConfigId: model.id, modelConfigUpdatedAt: model.updatedAt, dimension: null },
    batchSize,
  );
  if (stickers.length === 0) return { embeddedCount: 0 };

  const vectors = await runtime.embeddings.embedTexts(
    stickers.map(buildStickerSemanticText),
    model,
    input.signal ?? new AbortController().signal,
  );
  if (vectors.length !== stickers.length) {
    throw new Error('向量化模型返回的向量数量与输入文本数量不一致');
  }

  const now = runtime.now();
  for (let index = 0; index < stickers.length; index += 1) {
    const vector = vectors[index];
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error('向量化模型返回了空向量');
    }
    await runtime.repository.upsertStickerEmbedding({
      stickerId: stickers[index].id,
      modelConfigId: model.id,
      modelConfigUpdatedAt: model.updatedAt,
      semanticRevision: stickers[index].semanticRevision,
      dimension: vector.length,
      vector,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { embeddedCount: stickers.length };
}

/** 补齐缺失向量：只唤醒 worker，不在调用线程里发网络请求。 */
export async function backfillMissingStickerEmbeddings(): Promise<void> {
  emitStickerEmbeddingPending();
}

/**
 * 重建当前模型的全部向量：删除现有向量后由 worker 重新生成。
 * 其他历史模型的向量保留，切回旧模型且 revision 未变时可直接复用。
 */
export async function rebuildStickerEmbeddingIndex(): Promise<number> {
  const runtime = getStickersRuntimeDependencies();
  const model = await resolveStickerEmbeddingModel();
  if (!model) {
    throw new Error('未配置向量化模型，无法重建语义索引');
  }
  const deleted = await runtime.repository.deleteStickerEmbeddingsByModel(model.id);
  emitStickerEmbeddingPending();
  return deleted;
}
