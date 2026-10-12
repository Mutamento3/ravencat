import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { getChatReplyRuntimeDependencies } from './ChatReplyRuntimeDependencies';

/** 供 Host 在工具事实提交的同一事务中查询 Chat 回合资格。 */
export function isChatReplyRunCurrentInTransaction(transaction: DatabaseTransactionExecutor, runId: string): Promise<boolean> {
  return getChatReplyRuntimeDependencies().mutations.isRunCurrent(transaction, runId);
}
