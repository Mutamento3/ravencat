/** 为 Chat 回复创建显式预算的 Agent task，transport 只决定模型传输方式。 */
import type { AgentTask, ModelTransportMode } from '@shared/aiTools';

export const CHAT_AGENT_TASK_BUDGET_PRESET = {
  maxSteps: 10,
  maxToolCalls: 30,
  maxToolCallsPerStep: 3,
} as const;

export interface CreateChatAgentTaskParams {
  runId: string;
  goal: string;
  assistantId: string;
  sessionId: string;
  allowedToolNames: string[];
  modelTransport: ModelTransportMode;
  createdAt: string;
}

export function createChatAgentTask(params: CreateChatAgentTaskParams): AgentTask {
  return {
    id: `chat_task_${params.runId}`,
    type: 'chat_reply',
    source: 'chat',
    goal: params.goal,
    assistantId: params.assistantId,
    sessionId: params.sessionId,
    allowedToolNames: [...params.allowedToolNames],
    modelTransport: params.modelTransport,
    ...CHAT_AGENT_TASK_BUDGET_PRESET,
    createdAt: params.createdAt,
  };
}
