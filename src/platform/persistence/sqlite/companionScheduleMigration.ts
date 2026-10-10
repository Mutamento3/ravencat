/** Self Wake 计划与历史迁入唯一 AI 日程表；只搬运事实，不生成唤醒或重放行动。 */
interface MigrationExecutor {
  execAsync(sql: string): Promise<void>;
  getAllAsync<T>(sql: string): Promise<T[]>;
  runAsync(sql: string, params: (string | null)[]): Promise<unknown>;
}

interface LegacyWakeRow {
  wake_id: string;
  owner_ai_id: string;
  wake_at: string;
  note: string | null;
  status: 'scheduled' | 'claimed' | 'consumed' | 'superseded';
  claimed_by_run_id: string | null;
  claimed_at: string | null;
  consumed_at: string | null;
  superseded_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function migrateCompanionSchedules(db: MigrationExecutor): Promise<void> {
  const legacy = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'raven_cat_self_wakes'",
  );
  await db.execAsync('BEGIN;');
  try {
    if (legacy.length) {
      // 保留 wakeId 与 claimed runId，既有 Chat anchor 不需要改写。被替换的计划保留取消事实。
      const rows = await db.getAllAsync<LegacyWakeRow>('SELECT * FROM raven_cat_self_wakes');
      for (const row of rows) {
        const note = row.note?.trim() || '自主唤醒';
        // 使用与 TS domain 相同的字符串长度口径，避免 SQLite 字符数与 UTF-16 长度不一致。
        await db.runAsync(`
          INSERT INTO raven_cat_ai_schedules (
            schedule_id, owner_ai_id, remind_at, summary, details, status,
            claimed_by_run_id, claimed_at, consumed_at, completion_disposition,
            cancelled_at, cancelled_reason, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        `, [
          row.wake_id, row.owner_ai_id, row.wake_at, note.slice(0, 160), note.slice(0, 4000),
          row.status === 'superseded' ? 'cancelled' : row.status,
          row.claimed_by_run_id, row.claimed_at, row.consumed_at,
          row.status === 'consumed' ? 'agent_terminal' : null,
          row.superseded_at, row.created_at, row.updated_at,
        ]);
      }
      await db.execAsync('DROP TABLE raven_cat_self_wakes;');
    }
    // 已有新工具授权优先；其余旧授权搬到唯一创建工具，退休旧工具 identity。
    await db.execAsync(`
      INSERT INTO assistant_tool_permissions (assistant_id, tool_name, enabled, updated_at)
        SELECT assistant_id, 'create_ai_schedule', enabled, updated_at
        FROM assistant_tool_permissions WHERE tool_name = 'schedule_self_wake'
        ON CONFLICT (assistant_id, tool_name) DO NOTHING;
      DELETE FROM assistant_tool_permissions WHERE tool_name = 'schedule_self_wake';
      COMMIT;
    `);
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
