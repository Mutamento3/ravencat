/** 定义主理 AI 全局关系状态，避免撤销冷静期依附于某个可删除的 AI。 */

export const HOST_AI_RELATIONSHIP_STATE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS host_ai_relationship_state (
    id TEXT PRIMARY KEY,
    last_revoked_ai_id TEXT,
    appointment_cooldown_start TEXT,
    appointment_cooldown_end TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;
