import type { DatabaseWriteExecutor } from '../runtime';

export const TOGETHER_LISTENING_ACTIVITIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS together_listening_activities (
    id TEXT PRIMARY KEY,
    host_ai_id TEXT NOT NULL,
    chat_session_id TEXT NOT NULL,
    initiator TEXT NOT NULL CHECK (initiator IN ('user', 'ai')),
    phase TEXT NOT NULL CHECK (phase IN (
      'pending_user_response', 'pending_ai_response', 'active',
      'declined_by_user', 'declined_by_ai', 'ended'
    )),
    created_at_epoch_ms INTEGER NOT NULL,
    updated_at_epoch_ms INTEGER NOT NULL,
    activated_at_epoch_ms INTEGER,
    ended_at_epoch_ms INTEGER,
    end_reason TEXT CHECK (end_reason IS NULL OR end_reason IN (
      'user_left', 'ai_left', 'media_unavailable', 'host_authority_lost',
      'chat_unavailable', 'runtime_reconciliation', 'unknown'
    ))
  );
`;

/** 常量表达式 partial index 在数据库层裁决全局唯一 non-terminal Activity。 */
export const TOGETHER_LISTENING_SINGLE_CURRENT_INDEX = `
  CREATE UNIQUE INDEX IF NOT EXISTS idx_together_listening_single_current
  ON together_listening_activities ((1))
  WHERE phase IN ('pending_user_response', 'pending_ai_response', 'active');
`;

export const TOGETHER_LISTENING_CHAT_CREATED_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_together_listening_chat_created
  ON together_listening_activities (chat_session_id, created_at_epoch_ms DESC);
`;

export const TOGETHER_LISTENING_HOST_CREATED_INDEX = `
  CREATE INDEX IF NOT EXISTS idx_together_listening_host_created
  ON together_listening_activities (host_ai_id, created_at_epoch_ms DESC);
`;

/** fresh DB 与 existing DB 共用同一个幂等 migration primitive。 */
export async function migrateTogetherListeningActivity(
  database: DatabaseWriteExecutor,
): Promise<void> {
  await database.execAsync(TOGETHER_LISTENING_ACTIVITIES_SCHEMA);
  await database.execAsync(TOGETHER_LISTENING_SINGLE_CURRENT_INDEX);
  await database.execAsync(TOGETHER_LISTENING_CHAT_CREATED_INDEX);
  await database.execAsync(TOGETHER_LISTENING_HOST_CREATED_INDEX);
}
