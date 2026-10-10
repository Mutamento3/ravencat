/** 正式 Headless AI Schedule：以 SQLite due-time CAS claim 为幂等边界执行一次 autonomous run。 */

import type { AgentRunResult } from '@platform/agentRuntime';
import { runAsCurrentHostAuthority } from '@features/assistants';
import type {
  AISchedule,
  AIScheduleCompletionDisposition,
} from '../domain/AISchedule';
import type { AIScheduleApplicationErrorCode } from './AIScheduleApplication';
import {
  claimAIScheduleForHeadless,
  consumeAIScheduleWithProjection,
} from './AIScheduleProjectionOwner';
import { summarizeAutonomousAgentRun } from './AutonomousRunDiagnostic';
import {
  claimAndTrackAIScheduleRun,
  completeTrackedAIScheduleRun,
} from './AIScheduleRecovery';
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';
import { runAIScheduleAutonomousAgent } from './RunAIScheduleAutonomousAgent';

export interface HeadlessAIScheduleData {
  triggerKind?: string | null;
  source?: string;
  eventId?: string;
  hostAIId?: string | null;
  expectedRemindAtEpochMs?: number | null;
  projectionToken?: string | null;
  createdAtEpochMs?: number;
  deliveryEventId?: string | null;
}

export type HeadlessAIScheduleOutcome =
  | { status: 'ran'; result: AgentRunResult }
  | { status: 'ignored'; reason: 'not_current_host' }
  | {
      status: 'ignored';
      reason: 'claim_rejected';
      claimStatus: AIScheduleApplicationErrorCode;
    };

export async function runHeadlessAISchedule(
  data: HeadlessAIScheduleData,
  signal?: AbortSignal,
): Promise<HeadlessAIScheduleOutcome> {
  const dependencies = getCompanionRuntimeDependencies();
  const callback = parseFormalAIScheduleCallback(data);
  await dependencies.initializeDatabase();
  const authority = await runAsCurrentHostAuthority(callback.hostAIId, async () => {
    const runId = dependencies.generateAutonomousRunId();
    const claim = await claimAndTrackAIScheduleRun(runId, () => claimAIScheduleForHeadless({
      scheduleId: callback.scheduleId,
      ownerAIId: callback.hostAIId,
      runId,
      claimedAt: callback.triggeredAt,
      expectedRemindAt: callback.expectedRemindAt,
      projectionToken: callback.projectionToken,
    }));
    return { runId, claim };
  });

  if (authority.status === 'not_current_host') {
    console.info('[RavenCatAIScheduleTask] AI Schedule callback 已过期', {
      scheduleId: callback.scheduleId,
      reason: authority.status,
    });
    return { status: 'ignored', reason: authority.status };
  }

  const { runId, claim } = authority.value;
  if (claim.status !== 'claimed') {
    console.info('[RavenCatAIScheduleTask] AI Schedule callback 未取得执行权', {
      scheduleId: callback.scheduleId,
      claimStatus: claim.code,
    });
    return { status: 'ignored', reason: 'claim_rejected', claimStatus: claim.code };
  }
  const result = await runClaimedAISchedule({
    runId,
    claimedSchedule: claim.schedule,
    triggeredAt: callback.triggeredAt,
    signal,
  });
  return { status: 'ran', result };
}

async function runClaimedAISchedule(input: {
  runId: string;
  claimedSchedule: AISchedule;
  triggeredAt: string;
  signal?: AbortSignal;
}): Promise<AgentRunResult> {
  let primaryError: unknown;
  let result: AgentRunResult | undefined;
  let completionDisposition: AIScheduleCompletionDisposition = 'interrupted';
  try {
    if (input.claimedSchedule.claimedByRunId !== input.runId) {
      throw new Error('AI Schedule claim 返回的 claimedByRunId 与 autonomous runId 不一致');
    }
    result = await runAIScheduleAutonomousAgent(input);
    completionDisposition = 'agent_terminal';
    logAutonomousRunTerminal({
      scheduleId: input.claimedSchedule.scheduleId,
      runId: input.runId,
      result,
    });
  } catch (error) {
    primaryError = error;
  }

  try {
    await completeTrackedAIScheduleRun(
      input.runId,
      completionDisposition,
      async () => {
        const outcome = await consumeAIScheduleWithProjection({
          scheduleId: input.claimedSchedule.scheduleId,
          runId: input.runId,
          consumedAt: new Date().toISOString(),
          completionDisposition,
        });
        if (outcome.status !== 'consumed' && outcome.code !== 'already_terminal') {
          throw new Error(
            `Claimed AI Schedule ${input.claimedSchedule.scheduleId} consume 失败：${outcome.code}`,
          );
        }
        return outcome;
      },
    );
  } catch (consumeError) {
    if (primaryError) {
      console.error('[RavenCatAIScheduleTask] autonomous run 与 consume 均失败', {
        scheduleId: input.claimedSchedule.scheduleId,
        runId: input.runId,
        consumeError,
      });
      throw primaryError;
    }
    throw consumeError;
  }

  if (primaryError) throw primaryError;
  return result!;
}

/** 诊断日志是纯 observer；摘要失败只降级为 error log，不改变 terminal result。 */
function logAutonomousRunTerminal(input: {
  scheduleId: string;
  runId: string;
  result: AgentRunResult;
}): void {
  try {
    console.info('[RavenCatAIScheduleTask] autonomous Agent run 已到达终态', {
      scheduleId: input.scheduleId,
      runId: input.runId,
      ...summarizeAutonomousAgentRun(input.result),
    });
  } catch (error) {
    console.error('[RavenCatAIScheduleTask] autonomous Agent run 诊断摘要不可用', {
      scheduleId: input.scheduleId,
      runId: input.runId,
      error,
    });
  }
}

function parseFormalAIScheduleCallback(data: HeadlessAIScheduleData): {
  scheduleId: string;
  hostAIId: string;
  expectedRemindAt: string;
  projectionToken: string;
  triggeredAt: string;
} {
  if (data.triggerKind !== 'ai_schedule' || data.source !== 'work-manager') {
    throw new Error(`正式 AI Schedule callback 类型非法：${data.triggerKind}/${data.source}`);
  }
  const scheduleId = data.eventId?.trim();
  if (!scheduleId) throw new Error('正式 AI Schedule callback 缺少 scheduleId');
  const hostAIId = data.hostAIId?.trim();
  if (!hostAIId) throw new Error('正式 AI Schedule callback 缺少 hostAIId');
  if (!Number.isFinite(data.expectedRemindAtEpochMs) || data.expectedRemindAtEpochMs! <= 0) {
    throw new Error('正式 AI Schedule callback 缺少有效 expectedRemindAtEpochMs');
  }
  const projectionToken = data.projectionToken?.trim();
  if (!projectionToken) throw new Error('正式 AI Schedule callback 缺少 projectionToken');
  if (!Number.isFinite(data.createdAtEpochMs) || data.createdAtEpochMs! <= 0) {
    throw new Error('正式 AI Schedule callback 缺少有效 triggeredAt');
  }
  return {
    scheduleId,
    hostAIId,
    expectedRemindAt: new Date(data.expectedRemindAtEpochMs!).toISOString(),
    projectionToken,
    triggeredAt: new Date(data.createdAtEpochMs!).toISOString(),
  };
}
