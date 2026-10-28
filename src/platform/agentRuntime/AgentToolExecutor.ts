/** 在统一边界解析工具参数、检查 allowlist，并隔离单个工具实现的异常。 */
import type {
  AgentTask,
  AgentTool,
  AgentToolExecutionContext,
} from '@shared/aiTools';
import { matchesAgentToolInputSchema } from '@shared/aiTools';
import type { ModelToolCall } from '@platform/ai';
import { AgentRuntimeTerminalError, type AgentToolOutcome } from './AgentRunState';
import type { AgentToolRegistry } from './AgentToolRegistry';

type AgentToolPreparationRejectionCode =
  | 'TOOL_NOT_ALLOWED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_INPUT_INVALID';

type AgentToolPreparation =
  | {
      status: 'ready';
      tool: AgentTool<unknown, unknown>;
      input: unknown;
    }
  | {
      status: 'rejected';
      outcome: Extract<AgentToolOutcome, { status: 'error' }> & {
        code: AgentToolPreparationRejectionCode;
      };
      closeToolAccess: boolean;
    };

export class AgentToolExecutor {
  constructor(private readonly registry: AgentToolRegistry) {}

  prepare(toolCall: ModelToolCall, task: AgentTask): AgentToolPreparation {
    const tool = this.registry.get(toolCall.name);
    if (!tool) {
      return {
        status: 'rejected',
        outcome: {
          status: 'error',
          code: 'TOOL_NOT_FOUND',
          retryable: false,
          modelContent: `工具 ${toolCall.name} 未注册，因此没有执行。请根据现有信息直接回复。`,
        },
        closeToolAccess: true,
      };
    }
    if (!task.allowedToolNames.includes(toolCall.name)) {
      return {
        status: 'rejected',
        outcome: {
          status: 'error',
          code: 'TOOL_NOT_ALLOWED',
          retryable: false,
          modelContent: `当前任务未授权工具 ${toolCall.name}，因此没有执行。请直接向用户说明限制。`,
        },
        closeToolAccess: true,
      };
    }

    const parsedInput = parseJsonInput(toolCall.arguments);
    if (parsedInput.status === 'invalid') {
      return {
        status: 'rejected',
        outcome: {
          status: 'error',
          code: 'TOOL_INPUT_INVALID',
          retryable: true,
          modelContent: `工具 ${toolCall.name} 的参数不是有效 JSON，因此没有执行。请修正参数后重试或直接回复。`,
        },
        closeToolAccess: false,
      };
    }
    if (!matchesAgentToolInputSchema(parsedInput.value, tool.descriptor.inputSchema)) {
      return {
        status: 'rejected',
        outcome: {
          status: 'error',
          code: 'TOOL_INPUT_INVALID',
          retryable: true,
          modelContent: `工具 ${toolCall.name} 的参数不符合 schema，因此没有执行。请按工具定义修正参数后重试或直接回复。`,
        },
        closeToolAccess: false,
      };
    }

    return {
      status: 'ready',
      tool,
      input: parsedInput.value,
    };
  }

  async execute(
    preparation: Extract<AgentToolPreparation, { status: 'ready' }>,
    context: AgentToolExecutionContext
  ): Promise<AgentToolOutcome> {
    try {
      return await preparation.tool.execute(preparation.input, context);
    } catch (error) {
      if (context.abortSignal.aborted) {
        throw error;
      }
      // Host 的持久资格检查可能先于协作式 signal 失效；只透传明确的 Runtime 控制信号。
      const terminal = error instanceof Error && error.cause instanceof AgentRuntimeTerminalError ? error.cause : error;
      if (terminal instanceof AgentRuntimeTerminalError) throw terminal;
      logUnexpectedToolError(preparation.tool.descriptor.name, context, error);
      return {
        status: 'error',
        code: 'TOOL_EXECUTION_FAILED',
        retryable: false,
        modelContent: '工具执行失败。',
      };
    }
  }
}

function logUnexpectedToolError(
  toolName: string,
  context: AgentToolExecutionContext,
  error: unknown,
): void {
  try {
    console.error('[AgentToolExecutor] tool execution failed', {
      toolName,
      runId: context.runId,
      taskId: context.task.id,
      assistantId: context.task.assistantId,
      error,
    });
  } catch {
    // 诊断日志不得改变工具执行结果。
  }
}

function parseJsonInput(argumentsText: string):
  | { status: 'valid'; value: unknown }
  | { status: 'invalid'; value: unknown } {
  try {
    return { status: 'valid', value: JSON.parse(argumentsText) as unknown };
  } catch {
    return { status: 'invalid', value: undefined };
  }
}
