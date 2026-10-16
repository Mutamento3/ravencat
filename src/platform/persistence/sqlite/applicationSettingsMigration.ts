import type { DatabaseWriteExecutor } from '../runtime';

/** 自主头像工具改为应用设置工具，保留用户原有的关闭与特批选择，不保留旧运行入口。 */
export async function migrateApplicationSettingsTools(db: DatabaseWriteExecutor): Promise<void> {
  await db.execAsync(`
    INSERT OR IGNORE INTO assistant_tool_permissions (assistant_id, tool_name, enabled, updated_at)
      SELECT assistant_id, 'set_ai_avatar', enabled, updated_at
      FROM assistant_tool_permissions WHERE tool_name = 'change_own_avatar';
    DELETE FROM assistant_tool_permissions WHERE tool_name = 'change_own_avatar';
    INSERT OR IGNORE INTO assistant_direct_tools (assistant_id, tool_name)
      SELECT assistant_id, 'set_ai_avatar' FROM assistant_direct_tools WHERE tool_name = 'change_own_avatar';
    DELETE FROM assistant_direct_tools WHERE tool_name = 'change_own_avatar';
    INSERT OR IGNORE INTO prompt_default_switches (key, enabled)
      SELECT 'tool:set_ai_avatar', enabled FROM prompt_default_switches WHERE key = 'tool:change_own_avatar';
    DELETE FROM prompt_default_switches WHERE key = 'tool:change_own_avatar';
  `);
}
