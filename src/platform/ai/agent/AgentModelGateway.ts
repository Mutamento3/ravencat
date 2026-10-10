/** 提供 Agent 使用的 provider-neutral complete/stream 模型 turn 入口。 */
import type {
  ChatResponse,
  ChatStreamWithToolsOptions,
  ChatWithToolsOptions,
  ChatMessage,
  ToolDefinition,
} from '../types';
import { CompleteModelTurnAdapter } from './CompleteModelTurnAdapter';
import { StreamingModelTurnAdapter } from './StreamingModelTurnAdapter';
import type {
  ModelEventSink,
  ModelTurnResult,
} from './ModelEvent';

export interface AgentModelRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  toolChoice?: ChatWithToolsOptions['toolChoice'];
  includeSystemPrompt?: boolean;
  enforceReasoningContent?: boolean;
  signal?: AbortSignal;
}

export interface AgentModelProvider {
  chatWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatWithToolsOptions
  ): Promise<ChatResponse>;
  chatStreamWithTools(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatStreamWithToolsOptions
  ): Promise<ChatResponse>;
}

export type AgentModelEventSink = ModelEventSink;

export class AgentModelGateway {
  private readonly completeAdapter: CompleteModelTurnAdapter;
  private readonly streamingAdapter: StreamingModelTurnAdapter;

  constructor(provider: AgentModelProvider) {
    this.completeAdapter = new CompleteModelTurnAdapter(provider);
    this.streamingAdapter = new StreamingModelTurnAdapter(provider);
  }

  complete(request: AgentModelRequest, emit?: AgentModelEventSink): Promise<ModelTurnResult> {
    return this.completeAdapter.complete(request, emit);
  }

  stream(request: AgentModelRequest, emit?: AgentModelEventSink): Promise<ModelTurnResult> {
    return this.streamingAdapter.stream(request, emit);
  }
}
