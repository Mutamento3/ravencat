/** 使用通用表持久化每 AI 的逐工具授权。 */

import { databaseCoordinator } from '@platform/persistence';
import type {
  AssistantToolPermission,
  AssistantToolPermissionRepository,
} from '../domain/AssistantToolPermission';

type PermissionRow = {
  assistant_id: string;
  tool_name: string;
  enabled: number;
  updated_at: string;
};

export class SQLiteAssistantToolPermissionRepository implements AssistantToolPermissionRepository {
  async list(assistantId: string): Promise<AssistantToolPermission[]> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.list', feature: 'assistants', priority: 'runtime' });
    const rows = await db.getAllAsync<PermissionRow>(
      'SELECT * FROM assistant_tool_permissions WHERE assistant_id = ? ORDER BY tool_name',
      [assistantId]
    );
    return rows.map((row) => ({
      assistantId: row.assistant_id,
      toolName: row.tool_name,
      enabled: row.enabled === 1,
      updatedAt: row.updated_at,
    }));
  }

  async set(permission: AssistantToolPermission): Promise<AssistantToolPermission> {
    const db = databaseCoordinator.openTaskExecutor({ name: 'assistants.set', feature: 'assistants', priority: 'runtime' });
    await db.runAsync(
      `INSERT INTO assistant_tool_permissions (assistant_id, tool_name, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(assistant_id, tool_name) DO UPDATE SET
         enabled = excluded.enabled, updated_at = excluded.updated_at`,
      [permission.assistantId, permission.toolName, permission.enabled ? 1 : 0, permission.updatedAt]
    );
    return permission;
  }
}

export const assistantToolPermissionRepository = new SQLiteAssistantToolPermissionRepository();
