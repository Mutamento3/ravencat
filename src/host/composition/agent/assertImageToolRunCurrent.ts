import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type { AgentToolExecutionContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { isChatReplyRunCurrentInTransaction } from '@features/chat';

/** Chat 持久 fence 与工具取消各自负责资格与资源；其他宿主继续服从自身取消信号。 */
export async function assertImageToolRunCurrent(transaction: DatabaseTransactionExecutor, context: AgentToolExecutionContext): Promise<void> {
  throwIfAbortSignalAborted(context.abortSignal);
  if (context.task.source === 'chat' && !await isChatReplyRunCurrentInTransaction(transaction, context.runId)) {
    throw new DOMException('本轮已被新消息打断', 'AbortError');
  }
}
