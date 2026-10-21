/** AI Provider 技术能力公共出口。 */
export { BaseAIClient } from './BaseAIClient';
export { aiHttpDiagnostics } from './HttpExchangeDiagnostics';
export type { AIHttpExchange, AIHttpDiagnosticsSnapshot } from './HttpExchangeDiagnostics';
export { KimiClient } from './KimiClient';
export { OpenAIClient, createAIClient } from './OpenAIClient';
export { fetchModelList } from './modelDiscovery';
export { testAPIConnection } from './connectionTest';
export {
  detectParamError,
  detectQuotaError,
  detectServiceBusyError,
  getErrorDisplayInfo,
} from './errorMapping';
export { normalizeAIBaseURL } from './baseUrl';
export { resolveMoonshotAPIBaseURL } from './moonshotEndpoint';
export { MoonshotToolsClient } from './MoonshotToolsClient';
export type { MoonshotToolResult, MoonshotSearchInput, MoonshotSearchResult, MoonshotFetchResult, MoonshotMewInput, MoonshotMewResult } from './MoonshotToolsClient';
export { AgentModelGateway } from './agent/AgentModelGateway';
export { CompleteModelTurnAdapter } from './agent/CompleteModelTurnAdapter';
export { StreamingModelTurnAdapter } from './agent/StreamingModelTurnAdapter';
export { ModelTurnCollector } from './agent/ModelTurnCollector';
export type {
  AIClientConfig, ChatMessage, ContentPart, TextContentPart, ImageContentPart,
  ToolCall, ChatResponse, ChatStreamDelta, ChatStreamOptions,
  ChatStreamWithToolsOptions, EmbeddingResponse, ConnectionTestResult,
  ParamErrorInfo, QuotaErrorInfo, ServiceBusyErrorInfo, ErrorDisplayInfo,
  ModelInfo, ToolDefinition, ChatOptions, ChatWithToolsOptions,
  ConnectionTestOptions,
} from './types';
export type {
  AgentModelEventSink,
  AgentModelProvider,
  AgentModelRequest,
} from './agent/AgentModelGateway';
export type {
  ModelEvent,
  ModelEventSink,
  ModelFinishReason,
  ModelHistoryItem,
  ModelToolCall,
  ModelToolResultHistoryItem,
  ModelTurnResult,
  ModelUsage,
} from './agent/ModelEvent';
