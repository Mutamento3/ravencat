/** Sticker 业务表的建表与索引语句，供数据库初始化和后续 migration 复用。 */

/** Sticker 分组只保存库内的组织关系，不携带媒体文件状态。 */
export const STICKER_GROUPS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sticker_groups (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0)
  );
`;

/**
 * Sticker 是 MediaAsset 的业务引用。media_asset_id 唯一，保证同一份媒体在当前
 * 收藏库中只有一条 Sticker 记录；删除 Sticker 刻意不级联删除 MediaAsset。
 */
export const STICKERS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS stickers (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
    media_asset_id TEXT NOT NULL UNIQUE CHECK (length(trim(media_asset_id)) > 0),
    group_id TEXT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    description TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]' CHECK (length(tags_json) > 0),
    emotion TEXT,
    source_file_name TEXT,
    mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    is_animated INTEGER NOT NULL DEFAULT 0 CHECK (is_animated IN (0, 1)),
    is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    last_used_at TEXT,
    annotation_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (annotation_status IN ('pending', 'processing', 'ready', 'manual_required', 'failed')),
    annotation_error TEXT,
    annotation_claim_id TEXT,
    annotation_claimed_at TEXT,
    semantic_revision INTEGER NOT NULL DEFAULT 1 CHECK (semantic_revision >= 1),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    CHECK (
      (annotation_status = 'processing'
        AND annotation_claim_id IS NOT NULL
        AND annotation_claimed_at IS NOT NULL)
      OR
      (annotation_status <> 'processing'
        AND annotation_claim_id IS NULL
        AND annotation_claimed_at IS NULL)
    ),
    CHECK (
      (annotation_status = 'failed'
        AND annotation_error IS NOT NULL
        AND length(trim(annotation_error)) > 0)
      OR
      (annotation_status <> 'failed' AND annotation_error IS NULL)
    ),
    FOREIGN KEY (media_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
    FOREIGN KEY (group_id) REFERENCES sticker_groups(id) ON DELETE SET NULL
  );
`;

export const STICKER_GROUPS_ORDER_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sticker_groups_order
    ON sticker_groups(sort_order, name, id);
`;

export const STICKERS_GROUP_ORDER_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_stickers_group_order
    ON stickers(group_id, is_favorite DESC, last_used_at DESC, use_count DESC, id);
`;

export const STICKERS_FAVORITE_RECENT_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_stickers_favorite_recent
    ON stickers(is_favorite, last_used_at DESC, use_count DESC, id);
`;

export const STICKERS_ANNOTATION_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_stickers_annotation_claim
    ON stickers(annotation_status, annotation_claimed_at, updated_at, id);
`;

/**
 * Sticker System 的业务级模型绑定。两个字段都只保存辅助模型中心已有
 * AuxiliaryModelConfig.id；不保存第二份 Base URL / API Key / model name，
 * recognition 与 embedding 均属于 Sticker 自己的业务选择，不借用其他系统设置。
 */
export const STICKER_SYSTEM_CONFIG_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sticker_system_config (
    id TEXT PRIMARY KEY NOT NULL CHECK (id = 'global'),
    recognition_model_config_id TEXT,
    embedding_model_config_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

/**
 * Sticker 语义向量索引。向量有效性由四元组共同决定：模型 ID、模型配置
 * updatedAt 指纹、semantic revision 与查询维度；任一不匹配即视为 stale。
 * 收藏规模为数百到低几千张，第一版直接用 vector_json 全量扫描做余弦。
 */
export const STICKER_EMBEDDINGS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sticker_embeddings (
    sticker_id TEXT NOT NULL,
    model_config_id TEXT NOT NULL,
    model_config_updated_at TEXT NOT NULL CHECK (length(trim(model_config_updated_at)) > 0),
    semantic_revision INTEGER NOT NULL CHECK (semantic_revision >= 1),
    dimension INTEGER NOT NULL CHECK (dimension > 0),
    vector_json TEXT NOT NULL CHECK (length(vector_json) > 2),
    created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
    updated_at TEXT NOT NULL CHECK (length(trim(updated_at)) > 0),
    PRIMARY KEY (sticker_id, model_config_id),
    FOREIGN KEY (sticker_id) REFERENCES stickers(id) ON DELETE CASCADE
  );
`;

export const STICKER_EMBEDDINGS_MODEL_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_sticker_embeddings_model
    ON sticker_embeddings(model_config_id, updated_at);
`;

/**
 * 便于调用方一次执行本 Feature 的全部 SQL。各单项常量仍单独导出，方便 migration
 * 在已有库上按阶段复用而不必复制字符串。
 */
export const STICKER_SCHEMA = [
  STICKER_GROUPS_SCHEMA,
  STICKERS_SCHEMA,
  STICKER_GROUPS_ORDER_INDEX,
  STICKERS_GROUP_ORDER_INDEX,
  STICKERS_FAVORITE_RECENT_INDEX,
  STICKERS_ANNOTATION_INDEX,
].join('\n');

/** Sticker System V2 的新增 schema；迁移 81 之后的老库由迁移 84 补齐。 */
export const STICKER_V2_SCHEMA = [
  STICKER_SYSTEM_CONFIG_SCHEMA,
  STICKER_EMBEDDINGS_SCHEMA,
  STICKER_EMBEDDINGS_MODEL_INDEX,
].join('\n');
