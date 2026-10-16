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

/** Host 工具包的暴露变更；按工具实际执行顺序交给回复提交 owner。 */
export interface ToolPackageExposureChange {
  packageId: string;
  action: 'open' | 'close';
}

export interface AgentToolExecutionMetadata {
  /**
   * 工具结果已经产生将由业务 owner 在 run 完成时提交的用户可见输出。
   * 只有拥有 canonical 输出投影的工具才能设置；Runtime 据此允许最终正文为空。
   */
  fulfillsUserVisibleOutput?: boolean;
  /**
   * 用户可见输出工具转交模型声明的成功后意图；只有输出意图已准备成功才能设置。
   * Runtime 在整批成功且最后一个工具选择 finish 时进入正常完成流程。
   */
  completionIntent?: 'finish' | 'continue';
  /** Chat 随正式回复原子保存；不代表工具授权变化。 */
  toolPackageChange?: ToolPackageExposureChange;
  [key: string]: unknown;
}

export type AgentToolExecutionResult<T> =
  | {
      status: 'success';
      data: T;
      modelContent: string;
      /** 工具提供的真实视觉输入；只进入模型 history，不创建用户消息。 */
      modelImages?: { url: string }[];
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
