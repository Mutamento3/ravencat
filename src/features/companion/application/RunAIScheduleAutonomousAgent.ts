/** 以 claimed AI Schedule 的同一 runId 启动一次正常 Host autonomous Agent Run。 */

import type { AgentRunResult } from '@platform/agentRuntime';
import type { AISchedule } from '../domain/AISchedule';
import { buildAIScheduleTriggerBlocks } from './CompanionPromptBlocks';
import { runHostAutonomousAgent } from './RunHostAutonomousAgent';

export interface RunAIScheduleAutonomousAgentInput {
  runId: string;
  sessionId: string;
  claimedSchedule: AISchedule;
  triggeredAt: string;
  signal?: AbortSignal;
}

export async function runAIScheduleAutonomousAgent(
  input: RunAIScheduleAutonomousAgentInput,
): Promise<AgentRunResult> {
  return runHostAutonomousAgent({
    runId: input.runId,
    sessionId: input.sessionId,
    ownerAIId: input.claimedSchedule.ownerAIId,
    triggeredAt: input.triggeredAt,
    correlationId: input.claimedSchedule.scheduleId,
    scenarioId: 'raven_cat.ai_schedule_trigger',
    triggerSource: 'raven_cat_ai_schedule',
    triggerReason: 'ai_schedule',
    relatedEntityType: 'raven_cat_ai_schedule',
    relatedEntityId: input.claimedSchedule.scheduleId,
    taskGoal:
      '当前主理 AI 因一条已到期的 AI Schedule 获得一次自主行动机会，应根据最新上下文自行判断是否需要使用任何已授权能力。',
    taskSource: 'raven_cat_ai_schedule',
    additionalPromptBlocks: buildAIScheduleTriggerBlocks({
      scheduleId: input.claimedSchedule.scheduleId,
      remindAt: input.claimedSchedule.remindAt,
      summary: input.claimedSchedule.summary,
      details: input.claimedSchedule.details,
      sourceExcerpt: input.claimedSchedule.sourceExcerpt,
      triggeredAt: input.triggeredAt,
    }),
    signal: input.signal,
  });
}
