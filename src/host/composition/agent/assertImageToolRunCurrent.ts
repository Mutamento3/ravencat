import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { AgentRuntimeTerminalError } from '@platform/agentRuntime';
import type { AgentToolExecutionContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import { isChatReplyRunCurrentInTransaction, isGroupSpeechTaskRunCurrentInTransaction } from '@features/chat';

/** Chat 持久 fence 与工具取消各自负责资格与资源；其他宿主继续服从自身取消信号。 */
export async function assertImageToolRunCurrent(transaction: DatabaseTransactionExecutor, context: AgentToolExecutionContext): Promise<void> {
  throwIfAbortSignalAborted(context.abortSignal);
  if (context.task.type === 'group_chat_reply') {
    if (!await isGroupSpeechTaskRunCurrentInTransaction(transaction, context.runId)) throw new AgentRuntimeTerminalError('SUPERSEDED');
    return;
  }
  if (context.task.source === 'chat' && !await isChatReplyRunCurrentInTransaction(transaction, context.runId)) {
    throw new AgentRuntimeTerminalError('SUPERSEDED');
  }
}
