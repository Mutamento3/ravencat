/** Sticker 收藏库的 SQLite adapter；所有 SQL 都经过 databaseCoordinator 调度。 */

import {
  databaseCoordinator,
  type CoordinatedDatabaseExecutor,
  type DatabaseTransactionExecutor,
} from '@platform/persistence';
import {
  parseStickerTags,
  STICKER_GROUP_LIMIT,
  STICKER_LIBRARY_MAX_COUNT,
  STICKER_LIST_LIMIT,
  STICKER_RECENT_LIMIT,
  StickerAnnotationClaimLostError,
  StickerGroupNotFoundError,
  StickerLibraryFullError,
  StickerNotFoundError,
  type ListStickersInput,
  type SearchStickersInput,
  type Sticker,
  type StickerAnnotationClaim,
  type StickerAnnotationMetadata,
  type StickerAnnotationStatus,
  type StickerGroup,
  type StickerMetadataPatch,
} from '../domain/Sticker';
import type { StickerEmbedding } from '../domain/StickerEmbedding';
import type { StickerSystemConfig } from '../domain/StickerSystemConfig';
import type {
  CreateStickerGroupInput,
  ListStickersInGroupInput,
  StickerEmbeddingModelContext,
  StickerGroupReadySummary,
  StickerRepository,
  StickerSemanticSearchInput,
} from '../domain/StickerRepository';

interface StickerRow {
  id: string;
  media_asset_id: string;
  group_id: string | null;
  name: string;
  description: string | null;
  tags_json: string;
  emotion: string | null;
  source_file_name: string | null;
  mime_type: string;
  width: number | null;
  height: number | null;
  is_animated: number;
  is_favorite: number;
  use_count: number;
  last_used_at: string | null;
  annotation_status: StickerAnnotationStatus;
  annotation_error: string | null;
  annotation_claim_id: string | null;
  annotation_claimed_at: string | null;
  semantic_revision: number;
  created_at: string;
  updated_at: string;
}

interface StickerEmbeddingRow {
  sticker_id: string;
  model_config_id: string;
  model_config_updated_at: string;
  semantic_revision: number;
  dimension: number;
  vector_json: string;
  created_at: string;
  updated_at: string;
}

interface StickerGroupRow {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

const STICKER_COLUMNS = `
  id,
  media_asset_id,
  group_id,
  name,
  description,
  tags_json,
  emotion,
  source_file_name,
  mime_type,
  width,
  height,
  is_animated,
  is_favorite,
  use_count,
  last_used_at,
  annotation_status,
  annotation_error,
  annotation_claim_id,
  annotation_claimed_at,
  semantic_revision,
  created_at,
  updated_at
`;

const GROUP_COLUMNS = `
  id,
  name,
  sort_order,
  created_at,
  updated_at
`;

function mapStickerRow(row: StickerRow): Sticker {
  return {
    id: row.id,
    mediaAssetId: row.media_asset_id,
    groupId: row.group_id,
    name: row.name,
    description: row.description,
    tags: parseStickerTags(row.tags_json),
    emotion: row.emotion,
    sourceFileName: row.source_file_name,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    isAnimated: row.is_animated === 1,
    isFavorite: row.is_favorite === 1,
    useCount: row.use_count,
    lastUsedAt: row.last_used_at,
    annotationStatus: row.annotation_status,
    annotationError: row.annotation_error,
    semanticRevision: row.semantic_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapGroupRow(row: StickerGroupRow): StickerGroup {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function limitFor(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(STICKER_LIST_LIMIT, Math.floor(value)));
}

function normalizeSearchTags(tags: readonly string[] | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of tags ?? []) {
    const tag = value.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    normalized.push(tag);
  }
  return normalized.slice(0, 32);
}

function normalizeSearchText(value: string | undefined): string {
  return value?.trim() ?? '';
}

function buildStickerValues(sticker: Sticker): (string | number | null)[] {
  return [
    sticker.id,
    sticker.mediaAssetId,
    sticker.groupId,
    sticker.name,
    sticker.description,
    JSON.stringify(sticker.tags),
    sticker.emotion,
    sticker.sourceFileName,
    sticker.mimeType,
    sticker.width,
    sticker.height,
    sticker.isAnimated ? 1 : 0,
    sticker.isFavorite ? 1 : 0,
    sticker.useCount,
    sticker.lastUsedAt,
    sticker.annotationStatus,
    sticker.annotationError,
    null,
    null,
    sticker.semanticRevision,
    sticker.createdAt,
    sticker.updatedAt,
  ];
}

function mapStickerEmbeddingRow(row: StickerEmbeddingRow): StickerEmbedding {
  let vector: number[];
  try {
    const parsed: unknown = JSON.parse(row.vector_json);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'number')) {
      throw new Error('vector 必须是数字数组');
    }
    vector = parsed;
  } catch (error) {
    throw new Error(`Sticker 向量数据损坏（sticker ${row.sticker_id}）：`, { cause: error });
  }
  return {
    stickerId: row.sticker_id,
    modelConfigId: row.model_config_id,
    modelConfigUpdatedAt: row.model_config_updated_at,
    semanticRevision: row.semantic_revision,
    dimension: row.dimension,
    vector,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * canonical 语义字段（name / description / tags / emotion）是否发生了实际变化。
 * 自动识别 complete 与手动编辑共用这一判定，保证同一条 revision 规则。
 */
function semanticFieldsChanged(
  current: Sticker,
  next: { name: string; description: string | null; tags: string[]; emotion: string | null },
): boolean {
  return (
    current.name !== next.name
    || current.description !== next.description
    || current.emotion !== next.emotion
    || current.tags.length !== next.tags.length
    || current.tags.some((tag, index) => tag !== next.tags[index])
  );
}

/**
 * Sticker adapter 不持有 raw SQLite connection。默认使用 Feature 专属 coordinator
 * executor；测试或 Host 组合可注入已经绑定 task metadata 的 executor。
 */
export class SQLiteStickerRepository implements StickerRepository {
  constructor(
    private readonly database: CoordinatedDatabaseExecutor = databaseCoordinator.openTaskExecutor({
      name: 'stickers.repository',
      feature: 'stickers',
      priority: 'runtime',
    }),
  ) {}

  async getStickerById(id: string): Promise<Sticker | null> {
    const row = await this.database.getFirstAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS} FROM stickers WHERE id = ? LIMIT 1`,
      [id],
    );
    return row ? mapStickerRow(row) : null;
  }

  async getStickerByMediaAssetId(mediaAssetId: string): Promise<Sticker | null> {
    const row = await this.database.getFirstAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS} FROM stickers WHERE media_asset_id = ? LIMIT 1`,
      [mediaAssetId],
    );
    return row ? mapStickerRow(row) : null;
  }

  async getGroupById(id: string): Promise<StickerGroup | null> {
    const row = await this.database.getFirstAsync<StickerGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM sticker_groups WHERE id = ? LIMIT 1`,
      [id],
    );
    return row ? mapGroupRow(row) : null;
  }

  async listGroups(): Promise<StickerGroup[]> {
    const rows = await this.database.getAllAsync<StickerGroupRow>(
      `SELECT ${GROUP_COLUMNS}
       FROM sticker_groups
       ORDER BY sort_order ASC, name COLLATE NOCASE ASC, id ASC
       LIMIT ${STICKER_GROUP_LIMIT}`,
    );
    return rows.map(mapGroupRow);
  }

  async listStickers(input: ListStickersInput = {}): Promise<Sticker[]> {
    const mode = input.mode ?? 'all';
    const limit = limitFor(input.limit, mode === 'recent' ? STICKER_RECENT_LIMIT : STICKER_LIST_LIMIT);
    const where: string[] = [];
    const params: (string | number)[] = [];

    if (mode === 'favorites') {
      where.push('is_favorite = 1');
    } else if (mode === 'recent') {
      where.push('last_used_at IS NOT NULL');
    }
    appendGroupFilter(where, params, input.groupId);

    const orderBy = mode === 'recent'
      ? 'last_used_at DESC, use_count DESC, id ASC'
      : 'created_at DESC, id ASC';
    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS}
       FROM stickers
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${orderBy}
       LIMIT ${limit}`,
      params,
    );
    return rows.map(mapStickerRow);
  }

  async searchStickers(input: SearchStickersInput): Promise<Sticker[]> {
    const limit = limitFor(input.limit, 100);
    const { where, params, tags } = buildStickerSearchFilters(input);

    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS}
       FROM stickers
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY is_favorite DESC, use_count DESC, last_used_at DESC, id ASC
       LIMIT ${limit}`,
      params,
    );
    return rows
      .map(mapStickerRow)
      .filter((sticker) => tags.every((tag) => sticker.tags.includes(tag)));
  }

  /**
   * 语义检索候选集：只按结构化条件过滤，不设 LIMIT——候选数量由收藏库总量
   * 上限（STICKER_LIBRARY_MAX_COUNT）决定，不能被 UI 列表分页上限截断。
   * 过滤语义与 searchStickers 完全共用，避免两条路径取到不同的集合。
   */
  async listReadyStickersForSemanticSearch(
    input: StickerSemanticSearchInput,
  ): Promise<Sticker[]> {
    const { where, params, tags } = buildStickerSearchFilters({
      readyOnly: true,
      groupId: input.groupId,
      tags: input.tags,
      emotion: input.emotion,
    });
    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS}
       FROM stickers
       WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id ASC`,
      params,
    );
    return rows
      .map(mapStickerRow)
      .filter((sticker) => tags.every((tag) => sticker.tags.includes(tag)));
  }

  async getStickerByIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    id: string,
  ): Promise<Sticker | null> {
    const row = await transaction.getFirstAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS} FROM stickers WHERE id = ? LIMIT 1`,
      [id],
    );
    return row ? mapStickerRow(row) : null;
  }

  async getStickerByMediaAssetIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    mediaAssetId: string,
  ): Promise<Sticker | null> {
    const row = await transaction.getFirstAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS} FROM stickers WHERE media_asset_id = ? LIMIT 1`,
      [mediaAssetId],
    );
    return row ? mapStickerRow(row) : null;
  }

  async getGroupByIdInTransaction(
    transaction: DatabaseTransactionExecutor,
    id: string,
  ): Promise<StickerGroup | null> {
    const row = await transaction.getFirstAsync<StickerGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM sticker_groups WHERE id = ? LIMIT 1`,
      [id],
    );
    return row ? mapGroupRow(row) : null;
  }

  async createStickerInTransaction(
    transaction: DatabaseTransactionExecutor,
    sticker: Sticker,
  ): Promise<void> {
    // 收藏库容量是集合级数据不变量，必须在与 insert 相同的事务里判定：
    // 否则并发导入会各自读到 499 然后一起写入。重复内容的复用由调用方在本事务
    // 内先按 media_asset_id 命中既有 Sticker，不会走到这里，因此不会误报。
    const currentCount = await this.countStickersInTransaction(transaction);
    if (currentCount >= STICKER_LIBRARY_MAX_COUNT) {
      throw new StickerLibraryFullError(STICKER_LIBRARY_MAX_COUNT);
    }
    await transaction.runAsync(
      `INSERT INTO stickers (
         id, media_asset_id, group_id, name, description, tags_json, emotion,
         source_file_name, mime_type, width, height, is_animated, is_favorite,
         use_count, last_used_at, annotation_status, annotation_error,
         annotation_claim_id, annotation_claimed_at, semantic_revision,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      buildStickerValues(sticker),
    );
  }

  async countStickersInTransaction(
    transaction: DatabaseTransactionExecutor,
  ): Promise<number> {
    const row = await transaction.getFirstAsync<{ total: number }>(
      'SELECT COUNT(*) AS total FROM stickers',
    );
    return row?.total ?? 0;
  }

  async createGroup(input: CreateStickerGroupInput): Promise<StickerGroup> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO sticker_groups (id, name, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [input.id, input.name, input.sortOrder, input.createdAt, input.updatedAt],
      );
    });
    return {
      id: input.id,
      name: input.name,
      sortOrder: input.sortOrder,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    };
  }

  async renameGroup(id: string, name: string, updatedAt: string): Promise<StickerGroup> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE sticker_groups SET name = ?, updated_at = ? WHERE id = ?`,
        [name, updatedAt, id],
      );
      if (result.changes !== 1) {
        throw new StickerGroupNotFoundError(id);
      }
      const group = await this.getGroupByIdInTransaction(transaction, id);
      if (!group) throw new StickerGroupNotFoundError(id);
      return group;
    });
  }

  async deleteGroup(id: string, updatedAt: string): Promise<boolean> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      // 显式清空引用，避免旧库 foreign_keys 配置差异改变业务语义。
      await transaction.runAsync(
        `UPDATE stickers SET group_id = NULL, updated_at = ? WHERE group_id = ?`,
        [updatedAt, id],
      );
      const result = await transaction.runAsync(
        `DELETE FROM sticker_groups WHERE id = ?`,
        [id],
      );
      return result.changes > 0;
    });
  }

  async updateStickerMetadata(
    id: string,
    patch: StickerMetadataPatch,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, id);
      if (!current) throw new StickerNotFoundError(id);
      const nextName = patch.name ?? current.name;
      const nextDescription = patch.description === undefined
        ? current.description
        : patch.description;
      const nextTags = patch.tags === undefined
        ? current.tags
        : [...patch.tags];
      const nextEmotion = patch.emotion === undefined ? current.emotion : patch.emotion;
      const bumpRevision = semanticFieldsChanged(current, {
        name: nextName,
        description: nextDescription,
        tags: nextTags,
        emotion: nextEmotion,
      });
      await transaction.runAsync(
        `UPDATE stickers
         SET name = ?, description = ?, tags_json = ?, emotion = ?,
             semantic_revision = CASE WHEN ? THEN semantic_revision + 1 ELSE semantic_revision END,
             updated_at = ?
         WHERE id = ?`,
        [
          nextName,
          nextDescription,
          JSON.stringify(nextTags),
          nextEmotion,
          bumpRevision ? 1 : 0,
          updatedAt,
          id,
        ],
      );
      const updated = await this.getStickerByIdInTransaction(transaction, id);
      if (!updated) throw new StickerNotFoundError(id);
      return updated;
    });
  }

  async setStickerFavorite(
    id: string,
    isFavorite: boolean | null,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, id);
      if (!current) throw new StickerNotFoundError(id);
      const next = isFavorite ?? !current.isFavorite;
      await transaction.runAsync(
        `UPDATE stickers SET is_favorite = ?, updated_at = ? WHERE id = ?`,
        [next ? 1 : 0, updatedAt, id],
      );
      const updated = await this.getStickerByIdInTransaction(transaction, id);
      if (!updated) throw new StickerNotFoundError(id);
      return updated;
    });
  }

  async moveSticker(id: string, groupId: string | null, updatedAt: string): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, id);
      if (!current) throw new StickerNotFoundError(id);
      if (groupId && !(await this.getGroupByIdInTransaction(transaction, groupId))) {
        throw new StickerGroupNotFoundError(groupId);
      }
      await transaction.runAsync(
        `UPDATE stickers SET group_id = ?, updated_at = ? WHERE id = ?`,
        [groupId, updatedAt, id],
      );
      const updated = await this.getStickerByIdInTransaction(transaction, id);
      if (!updated) throw new StickerNotFoundError(id);
      return updated;
    });
  }

  async deleteSticker(id: string): Promise<boolean> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      // 向量表虽有 ON DELETE CASCADE，但旧库 foreign_keys 配置可能未开启；
      // 显式删除保证语义索引不残留孤儿行。
      await transaction.runAsync(
        `DELETE FROM sticker_embeddings WHERE sticker_id = ?`,
        [id],
      );
      const result = await transaction.runAsync(
        `DELETE FROM stickers WHERE id = ?`,
        [id],
      );
      return result.changes > 0;
    });
  }

  async recordStickerUse(id: string, usedAt: string): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET use_count = use_count + 1, last_used_at = ?, updated_at = ?
         WHERE id = ?`,
        [usedAt, usedAt, id],
      );
      if (result.changes !== 1) throw new StickerNotFoundError(id);
      const updated = await this.getStickerByIdInTransaction(transaction, id);
      if (!updated) throw new StickerNotFoundError(id);
      return updated;
    });
  }

  async claimNextAnnotation(
    claimId: string,
    claimedAt: string,
  ): Promise<StickerAnnotationClaim | null> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const candidate = await transaction.getFirstAsync<StickerRow>(
        `SELECT ${STICKER_COLUMNS}
         FROM stickers
         WHERE annotation_status = 'pending'
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      );
      if (!candidate) return null;

      const claimed = await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'processing', annotation_claim_id = ?,
             annotation_claimed_at = ?, updated_at = ?
         WHERE id = ? AND annotation_status = 'pending'`,
        [claimId, claimedAt, claimedAt, candidate.id],
      );
      if (claimed.changes !== 1) return null;
      const sticker = await this.getStickerByIdInTransaction(transaction, candidate.id);
      if (!sticker) throw new StickerNotFoundError(candidate.id);
      return { sticker, claimId, claimedAt };
    });
  }

  async completeAnnotation(
    stickerId: string,
    claimId: string,
    metadata: StickerAnnotationMetadata,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!current) throw new StickerNotFoundError(stickerId);
      const nextName = metadata.name ?? current.name;
      const nextDescription = metadata.description === undefined
        ? current.description
        : metadata.description;
      const nextTags = metadata.tags === undefined ? current.tags : [...metadata.tags];
      const nextEmotion = metadata.emotion === undefined ? current.emotion : metadata.emotion;
      // 自动识别完成与手动编辑共用同一条 revision 规则：canonical 语义字段实际
      // 变化才 +1。识别结果与原值相同时不递增，避免无意义地把向量判为 stale。
      const bumpRevision = semanticFieldsChanged(current, {
        name: nextName,
        description: nextDescription,
        tags: nextTags,
        emotion: nextEmotion,
      });
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET name = ?, description = ?, tags_json = ?, emotion = ?,
             semantic_revision = CASE WHEN ? THEN semantic_revision + 1 ELSE semantic_revision END,
             annotation_status = 'ready', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE id = ? AND annotation_status = 'processing' AND annotation_claim_id = ?`,
        [
          nextName,
          nextDescription,
          JSON.stringify(nextTags),
          nextEmotion,
          bumpRevision ? 1 : 0,
          updatedAt,
          stickerId,
          claimId,
        ],
      );
      if (result.changes !== 1) throw new StickerAnnotationClaimLostError(stickerId);
      const updated = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!updated) throw new StickerNotFoundError(stickerId);
      return updated;
    });
  }

  async completeAnnotationManually(
    stickerId: string,
    metadata: StickerAnnotationMetadata,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!current) throw new StickerNotFoundError(stickerId);
      if (current.annotationStatus !== 'manual_required' && current.annotationStatus !== 'failed') {
        throw new Error(`当前 Sticker 不需要手动完成标注：${stickerId}`);
      }
      // 手动完成标注同样遵守 canonical 语义字段实际变化才递增 revision 的规则。
      const nextName = metadata.name ?? current.name;
      const nextDescription = metadata.description === undefined
        ? current.description
        : metadata.description;
      const nextTags = metadata.tags === undefined ? current.tags : [...metadata.tags];
      const nextEmotion = metadata.emotion === undefined ? current.emotion : metadata.emotion;
      const bumpRevision = semanticFieldsChanged(current, {
        name: nextName,
        description: nextDescription,
        tags: nextTags,
        emotion: nextEmotion,
      });
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET name = ?, description = ?, tags_json = ?, emotion = ?,
             semantic_revision = CASE WHEN ? THEN semantic_revision + 1 ELSE semantic_revision END,
             annotation_status = 'ready', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE id = ? AND annotation_status IN ('manual_required', 'failed')`,
        [
          nextName,
          nextDescription,
          JSON.stringify(nextTags),
          nextEmotion,
          bumpRevision ? 1 : 0,
          updatedAt,
          stickerId,
        ],
      );
      if (result.changes !== 1) throw new StickerNotFoundError(stickerId);
      const updated = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!updated) throw new StickerNotFoundError(stickerId);
      return updated;
    });
  }

  async failAnnotation(
    stickerId: string,
    claimId: string,
    error: string,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'failed', annotation_error = ?,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE id = ? AND annotation_status = 'processing' AND annotation_claim_id = ?`,
        [error, updatedAt, stickerId, claimId],
      );
      if (result.changes !== 1) {
        const current = await this.getStickerByIdInTransaction(transaction, stickerId);
        if (!current) throw new StickerNotFoundError(stickerId);
        throw new StickerAnnotationClaimLostError(stickerId);
      }
      const updated = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!updated) throw new StickerNotFoundError(stickerId);
      return updated;
    });
  }

  async releaseAnnotation(
    stickerId: string,
    claimId: string,
    updatedAt: string,
  ): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'pending', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE id = ? AND annotation_status = 'processing' AND annotation_claim_id = ?`,
        [updatedAt, stickerId, claimId],
      );
      if (result.changes !== 1) {
        const current = await this.getStickerByIdInTransaction(transaction, stickerId);
        if (!current) throw new StickerNotFoundError(stickerId);
        throw new StickerAnnotationClaimLostError(stickerId);
      }
      const updated = await this.getStickerByIdInTransaction(transaction, stickerId);
      if (!updated) throw new StickerNotFoundError(stickerId);
      return updated;
    });
  }

  async recoverAnnotationClaims(cutoff: string, updatedAt: string): Promise<number> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'pending', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE annotation_status = 'processing'
           AND annotation_claimed_at IS NOT NULL
           AND annotation_claimed_at <= ?`,
        [updatedAt, cutoff],
      );
      return result.changes;
    });
  }

  async recoverInterruptedAnnotationClaims(updatedAt: string): Promise<number> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'pending', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE annotation_status = 'processing'`,
        [updatedAt],
      );
      return result.changes;
    });
  }

  async retryAnnotation(id: string, updatedAt: string): Promise<Sticker> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const current = await this.getStickerByIdInTransaction(transaction, id);
      if (!current) throw new StickerNotFoundError(id);
      if (current.annotationStatus !== 'failed' || current.isAnimated) {
        throw new Error(`当前 Sticker 不可自动重试标注：${id}`);
      }
      await transaction.runAsync(
        `UPDATE stickers
         SET annotation_status = 'pending', annotation_error = NULL,
             annotation_claim_id = NULL, annotation_claimed_at = NULL,
             updated_at = ?
         WHERE id = ?`,
        [updatedAt, id],
      );
      const updated = await this.getStickerByIdInTransaction(transaction, id);
      if (!updated) throw new StickerNotFoundError(id);
      return updated;
    });
  }

  async listStickersByIds(ids: readonly string[]): Promise<Sticker[]> {
    const uniqueIds = [...new Set(ids)].filter((id) => id.trim());
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS}
       FROM stickers
       WHERE id IN (${placeholders})`,
      uniqueIds,
    );
    return rows.map(mapStickerRow);
  }

  // -- Sticker System 业务级模型配置 --

  async getStickerSystemConfig(): Promise<StickerSystemConfig | null> {
    const row = await this.database.getFirstAsync<{
      recognition_model_config_id: string | null;
      embedding_model_config_id: string | null;
      updated_at: string;
    }>(
      `SELECT recognition_model_config_id, embedding_model_config_id, updated_at
       FROM sticker_system_config WHERE id = 'global' LIMIT 1`,
    );
    if (!row) return null;
    return {
      recognitionModelConfigId: row.recognition_model_config_id,
      embeddingModelConfigId: row.embedding_model_config_id,
      updatedAt: row.updated_at,
    };
  }

  /** 两种能力独立首次初始化，不能写回另一种能力的旧快照。 */
  async initializeSystemModelInTransaction(transaction: DatabaseTransactionExecutor, requirement: 'ocr' | 'embedding', modelConfigId: string, now: string): Promise<void> {
    const column = requirement === 'ocr' ? 'recognition_model_config_id' : 'embedding_model_config_id';
    await transaction.runAsync(`INSERT INTO sticker_system_config (id, ${column}, created_at, updated_at)
      VALUES ('global', ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      ${column} = excluded.${column}, updated_at = excluded.updated_at
      WHERE sticker_system_config.${column} IS NULL`, [modelConfigId, now, now]);
  }

  async saveStickerSystemConfig(config: StickerSystemConfig, updatedAt: string): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO sticker_system_config (
           id, recognition_model_config_id, embedding_model_config_id, created_at, updated_at
         ) VALUES ('global', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           recognition_model_config_id = excluded.recognition_model_config_id,
           embedding_model_config_id = excluded.embedding_model_config_id,
           updated_at = excluded.updated_at`,
        [
          config.recognitionModelConfigId,
          config.embeddingModelConfigId,
          updatedAt,
          updatedAt,
        ],
      );
    });
  }

  // -- 语义向量索引 --

  async upsertStickerEmbedding(embedding: StickerEmbedding): Promise<void> {
    await this.database.withExclusiveTransactionAsync(async (transaction) => {
      await transaction.runAsync(
        `INSERT INTO sticker_embeddings (
           sticker_id, model_config_id, model_config_updated_at, semantic_revision,
           dimension, vector_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(sticker_id, model_config_id) DO UPDATE SET
           model_config_updated_at = excluded.model_config_updated_at,
           semantic_revision = excluded.semantic_revision,
           dimension = excluded.dimension,
           vector_json = excluded.vector_json,
           updated_at = excluded.updated_at`,
        [
          embedding.stickerId,
          embedding.modelConfigId,
          embedding.modelConfigUpdatedAt,
          embedding.semanticRevision,
          embedding.dimension,
          JSON.stringify(embedding.vector),
          embedding.createdAt,
          embedding.updatedAt,
        ],
      );
    });
  }

  async listStickerEmbeddingsByStickerIds(
    stickerIds: readonly string[],
    modelConfigId: string,
  ): Promise<StickerEmbedding[]> {
    const uniqueIds = [...new Set(stickerIds)].filter((id) => id.trim());
    if (uniqueIds.length === 0) return [];
    const placeholders = uniqueIds.map(() => '?').join(', ');
    const rows = await this.database.getAllAsync<StickerEmbeddingRow>(
      `SELECT sticker_id, model_config_id, model_config_updated_at, semantic_revision,
              dimension, vector_json, created_at, updated_at
       FROM sticker_embeddings
       WHERE model_config_id = ? AND sticker_id IN (${placeholders})`,
      [modelConfigId, ...uniqueIds],
    );
    return rows.map(mapStickerEmbeddingRow);
  }

  async deleteStickerEmbeddingsByModel(modelConfigId: string): Promise<number> {
    return this.database.withExclusiveTransactionAsync(async (transaction) => {
      const result = await transaction.runAsync(
        `DELETE FROM sticker_embeddings WHERE model_config_id = ?`,
        [modelConfigId],
      );
      return result.changes;
    });
  }

  async countReadyStickers(): Promise<number> {
    const row = await this.database.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total FROM stickers WHERE annotation_status = 'ready'`,
    );
    return row?.total ?? 0;
  }

  async countValidStickerEmbeddings(context: StickerEmbeddingModelContext): Promise<number> {
    const row = await this.database.getFirstAsync<{ total: number }>(
      `SELECT COUNT(*) AS total
       FROM sticker_embeddings e
       JOIN stickers s ON s.id = e.sticker_id AND s.annotation_status = 'ready'
       WHERE e.model_config_id = ?
         AND e.model_config_updated_at = ?
         AND e.semantic_revision = s.semantic_revision
         ${context.dimension === null ? '' : 'AND e.dimension = ?'}`,
      context.dimension === null
        ? [context.modelConfigId, context.modelConfigUpdatedAt]
        : [context.modelConfigId, context.modelConfigUpdatedAt, context.dimension],
    );
    return row?.total ?? 0;
  }

  async listReadyStickersNeedingEmbedding(
    context: StickerEmbeddingModelContext,
    limit: number,
  ): Promise<Sticker[]> {
    const dimensionMismatch = context.dimension === null
      ? ''
      : `
           OR e.dimension <> ?
         )`;
    const conditionEnd = context.dimension === null
      ? `
         )`
      : dimensionMismatch;
    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT s.*
       FROM stickers s
       LEFT JOIN sticker_embeddings e
         ON e.sticker_id = s.id AND e.model_config_id = ?
       WHERE s.annotation_status = 'ready'
         AND (
           e.sticker_id IS NULL
           OR e.model_config_updated_at <> ?
           OR e.semantic_revision <> s.semantic_revision${conditionEnd}
       ORDER BY s.updated_at ASC, s.id ASC
       LIMIT ?`,
      context.dimension === null
        ? [context.modelConfigId, context.modelConfigUpdatedAt, Math.max(1, Math.floor(limit))]
        : [
            context.modelConfigId,
            context.modelConfigUpdatedAt,
            context.dimension,
            Math.max(1, Math.floor(limit)),
          ],
    );
    return rows.map(mapStickerRow);
  }

  // -- AI 分组浏览 --

  async listStickerGroupReadySummaries(): Promise<StickerGroupReadySummary[]> {
    const rows = await this.database.getAllAsync<{
      id: string;
      name: string;
      sticker_count: number;
    }>(
      `SELECT g.id, g.name, COUNT(s.id) AS sticker_count
       FROM sticker_groups g
       JOIN stickers s ON s.group_id = g.id AND s.annotation_status = 'ready'
       GROUP BY g.id, g.name
       ORDER BY g.sort_order ASC, g.name COLLATE NOCASE ASC, g.id ASC`,
    );
    return rows.map((row) => ({
      groupId: row.id,
      name: row.name,
      stickerCount: row.sticker_count,
    }));
  }

  async listStickersInGroupForAI(input: ListStickersInGroupInput): Promise<Sticker[]> {
    const limit = Math.max(1, Math.floor(input.limit));
    const cursor = input.cursor;
    const rows = await this.database.getAllAsync<StickerRow>(
      `SELECT ${STICKER_COLUMNS}
       FROM stickers
       WHERE annotation_status = 'ready' AND group_id = ?
         ${cursor ? 'AND (created_at < ? OR (created_at = ? AND id < ?))' : ''}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      cursor
        ? [input.groupId, cursor.createdAt, cursor.createdAt, cursor.stickerId, limit]
        : [input.groupId, limit],
    );
    return rows.map(mapStickerRow);
  }

}

/**
 * 普通词面查询与语义候选集共用的结构化过滤。两条路径必须使用同一套语义，
 * 否则“语义召回候选”会与“词面结果”落在不同集合上。
 * tags 单独返回，因为 SQL 只做粗筛，最终仍按解析后的标签精确判定。
 */
function buildStickerSearchFilters(input: SearchStickersInput): {
  where: string[];
  params: (string | number)[];
  tags: string[];
} {
  const query = normalizeSearchText(input.query);
  const tags = normalizeSearchTags(input.tags);
  const emotion = input.emotion?.trim() ?? '';
  const where: string[] = [];
  const params: (string | number)[] = [];

  if (input.readyOnly) {
    where.push("annotation_status = 'ready'");
  }
  if (query) {
    const pattern = `%${query}%`;
    where.push(`(
        LOWER(name) LIKE LOWER(?)
        OR LOWER(COALESCE(description, '')) LIKE LOWER(?)
        OR LOWER(COALESCE(emotion, '')) LIKE LOWER(?)
        OR LOWER(tags_json) LIKE LOWER(?)
      )`);
    params.push(pattern, pattern, pattern, pattern);
  }
  if (emotion) {
    where.push('emotion = ?');
    params.push(emotion);
  }
  for (const tag of tags) {
    where.push('tags_json LIKE ?');
    params.push(`%"${tag}"%`);
  }
  appendGroupFilter(where, params, input.groupId);
  return { where, params, tags };
}

function appendGroupFilter(
  where: string[],
  params: (string | number)[],
  groupId: string | null | undefined,
): void {
  if (groupId === undefined) return;
  if (groupId === null) {
    where.push('group_id IS NULL');
    return;
  }
  where.push('group_id = ?');
  params.push(groupId);
}

export const stickerRepository = new SQLiteStickerRepository();
