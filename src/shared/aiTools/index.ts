/** AI 工具上下文与执行数据结构的公共出口。 */
export { ToolContext } from './ToolContext';
export type {
  ToolAIConfig,
  ToolRepositories,
  ToolCallbacks,
  ToolContextParams,
  ToolRuntimeSnapshot,
} from './ToolContext';
export type {
  AIToolsConfig,
  OpenAIToolDefinition,
  Tool,
  ToolDefinition,
  ToolExecuteResult,
} from './ToolContracts';
export type {
  AgentTask,
  AgentTaskSource,
  AgentTool,
  AgentToolDescriptor,
  AgentToolExecutionContext,
  AgentToolExecutionMetadata,
  AgentToolExecutionResult,
  AgentToolIdempotency,
  AgentToolRisk,
  JsonSchema,
  ModelTransportMode,
} from './AgentToolContracts';
export { assertAgentToolInputSchema, matchesAgentToolInputSchema } from './AgentToolInputSchema';
export { applyHostModelRunToolExposure } from './HostModelRunPreparation';
export type {
  HostModelRunPreparationInput,
  HostModelRunPreparationResult,
  PrepareHostModelRun,
} from './HostModelRunPreparation';
