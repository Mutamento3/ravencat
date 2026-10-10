/** 定义 Provider 无关的单轮模型事件、工具调用和历史片段。 */

export type ModelFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter'
  | 'cancelled'
  | 'unknown';

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelToolCall {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

export interface ModelAssistantHistoryItem {
  role: 'assistant';
  content: string;
  reasoningText: string;
  toolCalls: ModelToolCall[];
}

export interface ModelToolResultHistoryItem {
  role: 'tool';
  toolCallId: string;
  name: string;
  content: string;
}

export type ModelHistoryItem = ModelAssistantHistoryItem | ModelToolResultHistoryItem;

export type ModelEvent =
  | { type: 'turn_started' }
  | { type: 'reasoning_delta'; text: string }
  | { type: 'assistant_text_delta'; text: string }
  | { type: 'assistant_text_completed'; text: string }
  | {
      type: 'tool_call_started';
      index: number;
      toolCallId: string;
      toolName: string | null;
    }
  | {
      type: 'tool_call_arguments_delta';
      index: number;
      toolCallId: string;
      delta: string;
    }
  | {
      type: 'tool_call_completed';
      index: number;
      toolCall: ModelToolCall;
    }
  | {
      type: 'turn_completed';
      usage: ModelUsage;
      finishReason: ModelFinishReason;
    };

export type ModelEventSink = (event: ModelEvent) => void | Promise<void>;

export interface ModelTurnResult {
  historyItems: ModelHistoryItem[];
  assistantText: string;
  reasoningText: string;
  toolCalls: ModelToolCall[];
  usage: ModelUsage;
  finishReason: ModelFinishReason;
}
