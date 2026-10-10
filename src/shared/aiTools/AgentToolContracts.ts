/** 定义与业务无关的 Agent 工具描述、执行上下文和结构化结果。 */

export type JsonSchema = {
  type?: string | readonly string[];
  properties?: Record<string, JsonSchema | boolean>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  [key: string]: unknown;
};

export type AgentTaskSource =
  | 'chat'
  | 'manual_test'
  | 'raven_cat_wake'
  | 'raven_cat_ai_schedule'
  | 'headless'
  | 'app_recovery'
  | 'internal_feature';

export type ModelTransportMode = 'complete' | 'stream';

export interface AgentTask {
  id: string;
  type: string;
  source: AgentTaskSource;
  goal: string;
  assistantId: string;
  sessionId: string | null;
  allowedToolNames: string[];
  modelTransport: ModelTransportMode;
  maxSteps: number;
  maxToolCalls: number;
  maxToolCallsPerStep: number;
  createdAt: string;
}

export type AgentToolRisk =
  | 'safe_read'
  | 'private_read'
  | 'reversible_write'
  | 'external_side_effect'
  | 'sensitive_action';

export type AgentToolIdempotency = 'idempotent' | 'key_required' | 'not_idempotent';

export interface AgentToolDescriptor {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  owner: string;
  source: 'local' | 'device' | 'mcp';
  risk: AgentToolRisk;
  idempotency: AgentToolIdempotency;
}

export interface AgentToolExecutionContext {
  runId: string;
  task: AgentTask;
  toolCallId: string;
  abortSignal: AbortSignal;
}

export interface AgentToolExecutionMetadata {
  /**
   * 工具结果已经产生将由业务 owner 在 run 完成时提交的用户可见输出。
   * 只有拥有 canonical 输出投影的工具才能设置；Runtime 据此允许最终正文为空。
   */
  fulfillsUserVisibleOutput?: boolean;
  /** Host 拆包成功的事实；Chat 在正式回复事务中持久化其三轮有效期。 */
  openedToolPackageId?: string;
  [key: string]: unknown;
}

export type AgentToolExecutionResult<T> =
  | {
      status: 'success';
      data: T;
      modelContent: string;
      metadata?: AgentToolExecutionMetadata;
    }
  | {
      status: 'error';
      code: string;
      retryable: boolean;
      modelContent: string;
    };

export interface AgentTool<TInput = unknown, TOutput = unknown> {
  descriptor: AgentToolDescriptor;
  execute(
    input: TInput,
    context: AgentToolExecutionContext
  ): Promise<AgentToolExecutionResult<TOutput>>;
}
