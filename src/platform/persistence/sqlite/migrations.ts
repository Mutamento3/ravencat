/** 当前数据库基线与之后的增量升级；开源前开发库不再重放历史迁移。 */
import type { DatabaseWriteExecutor } from '../runtime';
import { SCHEMAS, INDEXES } from './schema';
import { DEFAULT_RECORDS_SQL } from './defaultRecords';

/** 114/115 是旧代码里的迁移编号；已发布数据库实际停在 user_version=108。 */
export const DATABASE_SCHEMA_VERSION = 116;
const PUBLIC_RELEASE_VERSION = 108;

/** 当前公开版的关键结构。拒绝旧开发库，避免把不完整库误标为新基线。 */
const PUBLIC_RELEASE_COLUMNS: Record<string, readonly string[]> = {
  ai_assistants: ['agent_id', 'disable_thinking', 'is_host_ai', 'private_context_primary_limit', 'group_context_secondary_limit'],
  sessions: ['ai_assistant_id', 'visible_after_message_id', 'visible_after_at', 'pinned_at'],
  messages: ['turn_run_id', 'turn_item_index', 'voice_played_at'],
  memory_items: ['summary', 'normalized_summary'],
  mcp_server_assistants: ['server_id', 'assistant_id'],
  chat_regeneration_requests: ['session_id', 'source_run_id', 'revision'],
  raven_cat_ai_schedules: ['completion_disposition'],
};

/** 检查当前已发布版本的结构特征，不对旧开发库猜测升级路径。 */
async function assertPublicReleaseSchema(db: DatabaseWriteExecutor): Promise<void> {
  for (const [table, expected] of Object.entries(PUBLIC_RELEASE_COLUMNS)) {
    const columns = await db.getAllAsync<{ name: string }>(`PRAGMA table_info('${table}')`);
    const actual = new Set(columns.map(column => column.name));
    if (expected.some(column => !actual.has(column))) {
      throw new Error('数据库属于不再支持的开发版本，请完全卸载后重新安装；当前公开版的数据无需清除。');
    }
  }
}

/**
 * 初始化入口持有独占写作用域；此处拥有 schema/default/version 的事务。
 * 无升级时只补默认记录，支持恢复出厂后重建，不再扫描或删除历史业务数据。
 */
export async function runMigrations(db: DatabaseWriteExecutor): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row!.user_version;
  if (version === DATABASE_SCHEMA_VERSION) {
    await db.execAsync('BEGIN IMMEDIATE;');
    try {
      await db.execAsync(DEFAULT_RECORDS_SQL);
      await db.execAsync('COMMIT;');
    } catch (error) {
      await db.execAsync('ROLLBACK;');
      throw error;
    }
    return;
  }
  if (version !== 0 && version !== PUBLIC_RELEASE_VERSION) {
    throw new Error(`数据库版本 ${version} 不受当前版本支持，请使用匹配的 RavenCat 版本。`);
  }
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'android_metadata'",
  );
  const fresh = tables.length === 0;
  if (!fresh) {
    // 在任何 DDL/default 写入之前检查；失败不修改旧库。
    await assertPublicReleaseSchema(db);
    const retiredTables = new Set(['raven_cat_self_wakes', 'capability_bindings', 'assistant_capability_bindings', 'memory_entries']);
    if (tables.some(table => retiredTables.has(table.name))) {
      throw new Error('数据库仍包含旧开发结构，请完全卸载后重新安装。');
    }
  }

  await db.execAsync('BEGIN IMMEDIATE;');
  try {
    for (const sql of Object.values(SCHEMAS)) await db.execAsync(sql);
    for (const sql of Object.values(INDEXES)) await db.execAsync(sql);
    if (!fresh) {
      // 纳入公开版115的定向修复：只清理无有效主体的 MCP 授权，正常授权原样保留。
      await db.execAsync(`
        DELETE FROM mcp_server_assistants
        WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE id = server_id)
           OR NOT EXISTS (SELECT 1 FROM ai_assistants WHERE id = assistant_id);
        DELETE FROM mcp_tool_grants
        WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE id = server_id);
      `);
    }
    await db.execAsync(DEFAULT_RECORDS_SQL);
    await db.execAsync(`PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};`);
    await db.execAsync('COMMIT;');
  } catch (error) {
    await db.execAsync('ROLLBACK;');
    throw error;
  }
}
