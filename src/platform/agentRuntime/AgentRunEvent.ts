/** 定义 Runtime 对外发布的生命周期、增量和工具结果事件。 */
import type {
  AgentToolOutcome,
  AgentRunTerminalResult,
} from './AgentRunState';

export type AgentRunEvent =
  | { type: 'run_started'; runId: string; taskId: string }
  | { type: 'model_turn_started'; runId: string; stepIndex: number }
  | { type: 'reasoning_delta'; runId: string; stepIndex: number; text: string }
  | { type: 'assistant_text_delta'; runId: string; stepIndex: number; text: string }
  /** 模型已开始返回工具请求；这不是工具执行开始。 */
  | { type: 'model_tool_request_started'; runId: string; stepIndex: number; toolCallId: string; toolName: string | null }
  | {
      type: 'model_turn_completed';
      runId: string;
      stepIndex: number;
      hasToolCalls: boolean;
    }
  | {
      type: 'tool_call_proposed';
      runId: string;
      stepIndex: number;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: 'tool_call_started';
      runId: string;
      stepIndex: number;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: 'tool_call_completed';
      runId: string;
      stepIndex: number;
      toolCallId: string;
      toolName: string;
      outcome: AgentToolOutcome;
    }
  | {
      type: 'step_completed';
      runId: string;
      stepIndex: number;
      toolCallCount: number;
    }
  | { type: 'run_completed'; runId: string; result: AgentRunTerminalResult };

export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;
