/** Phase 3A Assistant 身份契约迁移。 */

import type { DatabaseWriteExecutor } from '../runtime';

interface StaleGroupMemberIdentityRow {
  member_id: string;
  group_id: string;
  assistant_id: string;
  stale_agent_id: string;
  current_agent_id: string;
}

/**
 * 修正当前群成员关系中的 actor key 快照。
 * 消息与发言任务属于已经提交的历史归因，本迁移不修改这些事实。
 */
export async function migrateAssistantIdentityContract(
  db: DatabaseWriteExecutor
): Promise<void> {
  await db.execAsync('BEGIN;');
  try {
    const invalidAssistant = await db.getFirstAsync<{ id: string }>(
      `SELECT id
       FROM ai_assistants
       WHERE agent_id IS NULL OR TRIM(agent_id) = ''
       LIMIT 1`
    );
    if (invalidAssistant) {
      throw new Error(
        `Assistant ${invalidAssistant.id} 缺少不可变 agentId，无法校正群成员身份快照`
      );
    }

    const staleRows = await db.getAllAsync<StaleGroupMemberIdentityRow>(
      `SELECT m.id AS member_id,
              m.group_id AS group_id,
              m.ai_assistant_id AS assistant_id,
              m.agent_id AS stale_agent_id,
              a.agent_id AS current_agent_id
       FROM group_chat_members m
       INNER JOIN ai_assistants a ON a.id = m.ai_assistant_id
       WHERE m.agent_id != a.agent_id
       ORDER BY m.group_id, m.display_order, m.id`
    );

    if (staleRows.length > 0) {
      console.warn(
        `[persistence:sqlite.bootstrap] 迁移59：发现 ${staleRows.length} 条群成员 agentId 快照不一致，` +
          `将按 Assistant 身份 owner 修正：${staleRows
            .map((row) => `${row.member_id}(${row.stale_agent_id} -> ${row.current_agent_id})`)
            .join(', ')}`
      );

      const updatedAt = new Date().toISOString();
      const result = await db.runAsync(
        `UPDATE group_chat_members
         SET agent_id = (
               SELECT a.agent_id
               FROM ai_assistants a
               WHERE a.id = group_chat_members.ai_assistant_id
             ),
             updated_at = ?
         WHERE EXISTS (
           SELECT 1
           FROM ai_assistants a
           WHERE a.id = group_chat_members.ai_assistant_id
             AND a.agent_id != group_chat_members.agent_id
         )`,
        [updatedAt]
      );
      if (result.changes !== staleRows.length) {
        throw new Error(
          `群成员身份快照审计为 ${staleRows.length} 条，实际修正 ${result.changes} 条，拒绝提交`
        );
      }
    }

    await db.execAsync('COMMIT;');
  } catch (error) {
    try {
      await db.execAsync('ROLLBACK;');
    } catch {
      // 事务可能尚未成功开始，保留原始迁移错误。
    }
    throw error;
  }
}
