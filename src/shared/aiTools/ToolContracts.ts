/** 定义 Feature 工具与应用级注册中心共享的稳定契约。 */
import type { MemoryParticipationMode } from '../prompt/types';
export interface ToolExecuteResult {
  success: boolean;
  message?: string;
  error?: string;
  /** 结构化失败原因；缺省时 Agent adapter 返回通用 LEGACY_TOOL_EXECUTION_FAILED。 */
  errorCode?: string;
  data?: unknown;
  /** 已完成读取的视觉观察，沿用 Agent history 附图契约。 */
  modelImages?: { url: string }[];
  suppressAssistantReply?: boolean;
}

/** OpenAI function calling 使用的函数定义。 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, any>;
    required?: readonly string[];
    additionalProperties?: boolean;
  };
}

/** Feature 拥有的 AI 工具实现契约。 */
export interface Tool<TArgs = any, TContext = any> {
  name: string;
  definition: ToolDefinition;
  execute: (args: TArgs, context: TContext) => Promise<ToolExecuteResult>;
}

/** 决定当前 AI 可见工具集合的配置。 */
export interface AIToolsConfig {
  baseURL?: string | null;
  apiBaseUrl?: string | null;
  isHostAI?: boolean;
  enableTools?: boolean;
  triggerSource?: string;
  capabilities?: string[];
  memoryParticipation?: MemoryParticipationMode;
  allowedToolNames?: string[];
  companionScheduleRevision?: number;
}

/** 发送给 AI Provider 的工具定义包装。 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: ToolDefinition;
}
