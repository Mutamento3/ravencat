/**
 * RavenCat Device Control Soft App Lock 业务真值表的建表与索引语句，
 * 供新库初始化（schema.ts）和幂等迁移（migrations.ts）共同复用。
 *
 * 本表只保存业务状态（active / released / expired / failed）；
 * native overlay 的 attached 等运行时投影状态不属于业务真值，禁止落在本表。
 */

export const RAVEN_CAT_SOFT_APP_LOCKS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS raven_cat_soft_app_locks (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
    target_package TEXT NOT NULL CHECK (length(trim(target_package)) > 0),
    source TEXT NOT NULL CHECK (source IN ('manual_test', 'ai_tool')),
    source_ai_id TEXT,
    reason TEXT,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    expires_at INTEGER CHECK (expires_at IS NULL OR expires_at >= 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'released', 'expired', 'failed')),
    CHECK (source <> 'ai_tool' OR (source_ai_id IS NOT NULL AND length(source_ai_id) > 0))
  );
`;

/** listActive / expireDue 都按 status 过滤；created_at DESC 保证稳定读取顺序。 */
export const RAVEN_CAT_SOFT_APP_LOCKS_STATUS_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_raven_cat_soft_app_locks_status
    ON raven_cat_soft_app_locks(status, created_at DESC);
`;

/** same actor + target active dedupe 的非唯一查询索引；业务 winner 仍由 repository transaction 裁决。 */
export const RAVEN_CAT_SOFT_APP_LOCKS_AI_ACTIVE_TARGET_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_raven_cat_soft_app_locks_ai_active_target
    ON raven_cat_soft_app_locks(source_ai_id, target_package, expires_at, created_at, id)
    WHERE source = 'ai_tool' AND status = 'active';
`;

/** 测试入口退休后解除存量测试锁，避免无到期时间的旧锁失去解除入口；保留历史与 AI 锁。 */
export const RAVEN_CAT_RELEASE_MANUAL_TEST_LOCKS = `
  UPDATE raven_cat_soft_app_locks
  SET status = 'released'
  WHERE source = 'manual_test' AND status = 'active';
`;
