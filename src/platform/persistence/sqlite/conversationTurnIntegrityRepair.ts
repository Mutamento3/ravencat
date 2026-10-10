/** 修复父会话已经删除、但历史版本未级联清理的回合运行时事实。 */

import type { DatabaseWriteExecutor } from '../runtime';

export async function repairConversationTurnForeignKeys(
  db: Pick<DatabaseWriteExecutor, 'execAsync' | 'getAllAsync'>,
): Promise<void> {
  // state 可能引用 run，因此必须先移除失去 conversation identity 的 state。
  await db.execAsync(`
    DELETE FROM conversation_turn_state
    WHERE NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = conversation_turn_state.session_id
    );

    DELETE FROM conversation_turn_runs
    WHERE NOT EXISTS (
      SELECT 1 FROM chat_conversations
      WHERE chat_conversations.id = conversation_turn_runs.session_id
    );
  `);

  const runViolations = await db.getAllAsync(
    `PRAGMA foreign_key_check('conversation_turn_runs')`,
  );
  const stateViolations = await db.getAllAsync(
    `PRAGMA foreign_key_check('conversation_turn_state')`,
  );
  if (runViolations.length > 0 || stateViolations.length > 0) {
    throw new Error('conversation turn 外键修复后仍存在违规记录');
  }
}
