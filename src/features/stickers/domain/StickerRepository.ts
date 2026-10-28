/** Sticker Feature 的持久化端口；具体 SQL 只属于 infrastructure。 */

import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type {
  ListStickersInput,
  SearchStickersInput,
  Sticker,
  StickerAnnotationClaim,
  StickerAnnotationMetadata,
  StickerGroup,
  StickerMetadataPatch,
} from './Sticker';
import type { StickerEmbedding } from './StickerEmbedding';
import type { StickerSystemConfig } from './StickerSystemConfig';
import type { StickerGroupPageCursor } from './StickerSearch';

export interface CreateStickerGroupInput {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** AI 分组浏览的轻量分组摘要：只统计 ready Sticker。 */
export interface StickerGroupReadySummary {
  groupId: string;
  name: string;
  stickerCount: number;
}

/** AI 分组浏览的 keyset 分页输入；cursor 为空表示第一页。 */
export interface ListStickersInGroupInput {
  groupId: string;
  cursor: StickerGroupPageCursor | null;
  limit: number;
}

/** 向量有效性判定所需的当前模型上下文；dimension 未知时传 null，跳过维度比较。 */
export interface StickerEmbeddingModelContext {
  modelConfigId: string;
  modelConfigUpdatedAt: string;
  dimension: number | null;
}

/**
 * 语义检索候选集的结构化过滤条件：只有 ready + 分组 / tags / emotion。
 * 刻意不包含文本 query 与 limit——语义召回需要覆盖过滤条件下的全部 ready
 * Sticker，候选数量由收藏库容量上限决定，而不是 UI 列表分页。
 */
export interface StickerSemanticSearchInput {
  assistantId?: string;
  groupId?: string | null;
  tags?: readonly string[];
  emotion?: string | null;
}

export interface StickerRepository {
  getStickerById(id: string, assistantId?: string): Promise<Sticker | null>;
  getStickerByMediaAssetId(mediaAssetId: string): Promise<Sticker | null>;
  listGroups(): Promise<StickerGroup[]>;
  listStickers(input?: ListStickersInput): Promise<Sticker[]>;
  searchStickers(input: SearchStickersInput): Promise<Sticker[]>;
  /**
   * 语义检索候选集：只按 ready + 结构化条件过滤，返回全部命中项，
   * 不受 STICKER_LIST_LIMIT 这类 UI / 普通列表分页上限约束。
   */
  listReadyStickersForSemanticSearch(input: StickerSemanticSearchInput): Promise<Sticker[]>;

  /** MediaAsset 创建事务内只执行 SQL，确保 asset 与 Sticker 引用原子提交。 */
  getStickerByIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    id: string,
    ownerAssistantId?: string | null,
  ): Promise<Sticker | null>;
  getStickerByMediaAssetIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    mediaAssetId: string,
    ownerAssistantId?: string | null,
  ): Promise<Sticker | null>;
  getGroupByIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    id: string,
  ): Promise<StickerGroup | null>;
  createStickerInTransaction(
    transaction: DatabaseTransactionExecutor,
    sticker: Sticker,
  ): Promise<void>;
  /** 收藏库容量判定必须在调用方事务内执行，才能与 insert 一起原子成立。 */
  countStickersInTransaction(transaction: DatabaseTransactionExecutor, ownerAssistantId?: string | null): Promise<number>;

  createGroup(input: CreateStickerGroupInput): Promise<StickerGroup>;
  renameGroup(id: string, name: string, updatedAt: string): Promise<StickerGroup>;
  deleteGroup(id: string, updatedAt: string): Promise<boolean>;
  updateStickerMetadata(
    id: string,
    patch: StickerMetadataPatch,
    updatedAt: string,
    ownerAssistantId?: string | null,
    guard?: (transaction: DatabaseTransactionExecutor) => Promise<void>,
  ): Promise<Sticker>;
  setStickerFavorite(id: string, isFavorite: boolean | null, updatedAt: string): Promise<Sticker>;
  moveSticker(id: string, groupId: string | null, updatedAt: string): Promise<Sticker>;
  deleteSticker(id: string, ownerAssistantId?: string | null, guard?: (transaction: DatabaseTransactionExecutor) => Promise<void>): Promise<boolean>;
  recordStickerUse(id: string, usedAt: string): Promise<Sticker>;

  // -- Sticker System 业务级模型配置（不借用其他系统的选择）--

  getStickerSystemConfig(): Promise<StickerSystemConfig | null>;
  saveStickerSystemConfig(config: StickerSystemConfig, updatedAt: string): Promise<void>;

  // -- 语义向量索引 --

  upsertStickerEmbedding(embedding: StickerEmbedding): Promise<void>;
  listStickerEmbeddingsByStickerIds(
    stickerIds: readonly string[],
    modelConfigId: string,
  ): Promise<StickerEmbedding[]>;
  /** 只删除指定模型的向量；切换模型时旧向量保留以备未来切回复用。 */
  deleteStickerEmbeddingsByModel(modelConfigId: string): Promise<number>;
  countReadyStickers(): Promise<number>;
  countValidStickerEmbeddings(context: StickerEmbeddingModelContext): Promise<number>;
  /** ready 且当前模型向量缺失 / stale 的 Sticker，供 embedding worker 领取。 */
  listReadyStickersNeedingEmbedding(
    context: StickerEmbeddingModelContext,
    limit: number,
  ): Promise<Sticker[]>;

  // -- AI 分组浏览 --

  listStickerGroupReadySummaries(): Promise<StickerGroupReadySummary[]>;
  listStickersInGroupForAI(input: ListStickersInGroupInput): Promise<Sticker[]>;

  claimNextAnnotation(
    claimId: string,
    claimedAt: string,
  ): Promise<StickerAnnotationClaim | null>;
  completeAnnotation(
    stickerId: string,
    claimId: string,
    metadata: StickerAnnotationMetadata,
    updatedAt: string,
  ): Promise<Sticker>;
  completeAnnotationManually(
    stickerId: string,
    metadata: StickerAnnotationMetadata,
    updatedAt: string,
  ): Promise<Sticker>;
  failAnnotation(
    stickerId: string,
    claimId: string,
    error: string,
    updatedAt: string,
  ): Promise<Sticker>;
  releaseAnnotation(
    stickerId: string,
    claimId: string,
    updatedAt: string,
  ): Promise<Sticker>;
  recoverInterruptedAnnotationClaims(updatedAt: string): Promise<number>;
}
