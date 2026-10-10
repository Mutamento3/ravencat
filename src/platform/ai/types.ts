/**
 * @fileoverview AI 基础设施类型定义
 *
 * 共享类型定义，供所有 AI 客户端模块使用
 *
 * @module platform/ai/types
 */

// ============================================================================
// AI 配置类型
// ============================================================================

export interface AIClientConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number | null;
  maxTokens?: number | null;
  topP?: number | null;
  systemPrompt?: string;
  disableThinking?: boolean;
}

// ============================================================================
// 消息类型
// ============================================================================

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = TextContentPart | ImageContentPart;

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentPart[];
  reasoning_content?: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

// ============================================================================
// 工具调用类型
// ============================================================================

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================================================
// 请求/响应类型
// ============================================================================

export interface ChatResponse {
  text: string;
  reasoningText?: string;
  /** Provider 已返回的原始 finish_reason，供 Agent adapter 做语义归一化。 */
  finishReason?: string | null;
  messageId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  success: boolean;
  error: string | null;
  toolCalls: ToolCall[] | null;
  isToolCall: boolean;
}

export type ChatStreamDelta =
  | {
      type: 'reasoning_delta';
      text: string;
    }
  | {
      type: 'answer_delta';
      text: string;
    }
  | {
      type: 'tool_call_start';
      toolCallId: string;
      index: number;
      name?: string;
    }
  | {
      type: 'tool_call_args_delta';
      toolCallId: string;
      index: number;
      argumentsDelta: string;
    }
  | {
      type: 'tool_call_done';
      toolCallId: string;
      index: number;
      name: string;
      arguments: string;
    }
  | {
      type: 'done';
    };

export interface EmbeddingResponse {
  errorCode?: 'authentication' | 'configuration' | 'model_unavailable' | 'input_too_long'
    | 'rate_limit' | 'network' | 'timeout' | 'service' | 'invalid_response' | 'dimension_mismatch' | 'unknown';
  embeddings: number[][];
  model: string | null;
  promptTokens: number;
  totalTokens: number;
  success: boolean;
  error: string | null;
}

export interface ConnectionTestResult {
  success: boolean;
  error: string | null;
}

// ============================================================================
// 错误类型
// ============================================================================

export interface ParamErrorInfo {
  isParamError: boolean;
  paramName: string | null;
  allowedValue: string | null;
  message: string;
}

export interface QuotaErrorInfo {
  isQuotaError: boolean;
  message: string;
}

export interface ServiceBusyErrorInfo {
  isServiceBusyError: boolean;
  message: string;
}

export interface ErrorDisplayInfo {
  title: string;
  message: string;
  type?: string;
  isParamError?: boolean;
  paramName?: string | null;
  allowedValue?: string | null;
}

// ============================================================================
// 模型发现类型
// ============================================================================

export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
}

// ============================================================================
// 工具定义类型
// ============================================================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================================================
// Chat 选项类型
// ============================================================================

export interface ChatOptions {
  includeSystemPrompt?: boolean;
  enforceReasoningContent?: boolean;
  allowReasoningLengthRetry?: boolean;
  allowImageContentFallback?: boolean;
  responseFormat?: 'json_object';
  signal?: AbortSignal;
}

export interface ChatStreamOptions extends ChatOptions {
  onDelta?: (delta: ChatStreamDelta) => void | Promise<void>;
}

export interface ChatWithToolsOptions {
  includeSystemPrompt?: boolean;
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  enforceReasoningContent?: boolean;
  allowReasoningLengthRetry?: boolean;
  signal?: AbortSignal;
}

export interface ChatStreamWithToolsOptions extends ChatWithToolsOptions {
  onDelta?: (delta: ChatStreamDelta) => void | Promise<void>;
}

// ============================================================================
// 连接测试选项
// ============================================================================

export interface ConnectionTestOptions {
  disableThinking?: boolean;
  temperature?: number | null;
  maxTokens?: number;
  topP?: number | null;
  skipParams?: boolean;
}

// ============================================================================
// OpenAI API 响应类型
// ============================================================================

export interface OpenAIChatCompletionResponse {
  id?: string;
  choices?: {
    message?: {
      content?: string | null;
      reasoning_content?: string;
      reasoning?: unknown;
      tool_calls?: unknown[];
    };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OpenAIEmbeddingResponse {
  model?: string;
  data?: {
    embedding?: number[];
    index?: number;
  }[];
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

