import type { DatabaseTransactionExecutor } from '@platform/persistence';

/** 展示事实在 T1/T4 原事务收口；新输入只放行通过 T3 的剩余分段。 */
export async function interruptTurnPresentationsInTransaction(
  transaction: DatabaseTransactionExecutor,
  sessionId: string,
  reason: string,
  runId?: string,
): Promise<void> {
  if (reason === 'new_input') {
    // 这是完成回复的交付加速，不是把失去所有权的执行提交成成功。
    // 只放行已经通过 T3 的 canonical 条目；T1 与它们的展示终态共用一个事务。
    await transaction.runAsync(`UPDATE chat_turn_display_items SET shown_version = version, shown_json = snapshot_json
      WHERE message_id IS NOT NULL AND run_id IN (SELECT p.run_id FROM chat_turn_presentations p
        JOIN conversation_turn_runs r ON r.run_id = p.run_id
        WHERE p.session_id = ? AND p.state = 'open' AND r.status = 'committed')`, [sessionId]);
    await transaction.runAsync(`UPDATE chat_turn_presentations SET state = 'completed', reason = 'new_input_flush', updated_at = ?
      WHERE session_id = ? AND state = 'open' AND run_id IN (SELECT run_id FROM conversation_turn_runs WHERE status = 'committed')`,
    [new Date().toISOString(), sessionId]);
  }
  await transaction.runAsync(
    `UPDATE chat_turn_presentations SET state = 'interrupted', reason = ?, updated_at = ?
     WHERE session_id = ? AND state = 'open'${runId ? ' AND run_id = ?' : ''}`,
    [reason, new Date().toISOString(), sessionId, ...(runId ? [runId] : [])],
  );
}
