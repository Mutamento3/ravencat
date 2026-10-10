/**
 * AI Schedule claimed 执行机会的进程内协调与重启恢复。
 *
 * SQLite claim 是跨进程的唯一执行权；这里的 activeRunIds 只用于协调同一
 * JS runtime 内的生命周期，不能替代 SQLite truth。claim 注册、consume
 * 收口与 recovery 各自进入同一条 application lane，避免 recovery 在 claim
 * 已提交但 run 尚未登记的窗口内误收口当前 run。
 */

import type {
  AISchedule,
  AIScheduleCompletionDisposition,
} from '../domain/AISchedule';
import type { AIScheduleRepository } from '../domain/AIScheduleRepository';
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';

export type AIScheduleRecoveryMode = 'cold_start' | 'foreground';

export interface AIScheduleRecoveryResult {
  mode: AIScheduleRecoveryMode;
  examined: number;
  skippedActive: number;
  recovered: number;
  alreadyTerminal: number;
}

export interface AIScheduleRecoveryDependencies {
  schedules: Pick<AIScheduleRepository, 'listAllClaimed' | 'consumeClaimed'>;
  now(): Date;
}

export class AIScheduleRecovery {
  private operationTail: Promise<void> = Promise.resolve();

  private readonly activeRunIds = new Set<string>();

  /**
   * 当前 JS runtime 已拿到 Agent 正式终态、但 consume 可能尚未提交的证据。
   * 这是跨 recovery 调用的短期协调状态，不是 durable truth；进程退出后
   * 必须丢失，旧 claim 才会按 interrupted 收口。
   */
  private readonly pendingTerminalDispositions = new Map<
    string,
    AIScheduleCompletionDisposition
  >();

  constructor(private readonly dependencies: AIScheduleRecoveryDependencies) {}

  /**
   * 在 claim transaction 完成后立即登记 run。调用方必须在 Agent 开始前
   * 调用本方法，并在最终 consume transaction 完成后调用
   * `completeTrackedRun`。
   */
  claimAndTrack<T>(runId: string, claim: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      const outcome = await claim();
      if (isClaimedOutcome(outcome)) this.activeRunIds.add(runId);
      return outcome;
    });
  }

  /**
   * 将 durable consume 放入同一 application lane；无论 consume 成功、已由
   * recovery 收口，还是因数据库错误失败，都必须释放当前进程的 active 标记。
   */
  completeTrackedRun<T>(
    runId: string,
    completionDisposition: AIScheduleCompletionDisposition,
    consume: () => Promise<T>,
  ): Promise<T> {
    if (completionDisposition === 'agent_terminal') {
      // 同步登记，避免 run 已返回到调用方但 lane 尚未开始时出现 recovery 窗口。
      this.pendingTerminalDispositions.set(runId, completionDisposition);
    }
    return this.enqueue(async () => {
      try {
        const result = await consume();
        this.pendingTerminalDispositions.delete(runId);
        return result;
      } finally {
        this.activeRunIds.delete(runId);
      }
    });
  }

  /**
   * 收口旧进程留下的 claimed。
   *
   * recovery 不判断年龄、不尝试重跑，也不把 schedule 改回 scheduled。每个
   * candidate 都必须以 durable snapshot 中的 scheduleId 与 claimedByRunId
   * 重新走 repository 的 claimed → consumed CAS；竞态中已经由正常 consume
   * 收口的记录只返回 already_terminal 并视为幂等成功。
   */
  recover(mode: AIScheduleRecoveryMode): Promise<AIScheduleRecoveryResult> {
    return this.enqueue(async () => {
      const claimed = await this.dependencies.schedules.listAllClaimed();
      let skippedActive = 0;
      let recovered = 0;
      let alreadyTerminal = 0;

      for (const schedule of claimed) {
        const runId = requireClaimedRunId(schedule);
        if (this.activeRunIds.has(runId)) {
          skippedActive += 1;
          continue;
        }

        const completionDisposition = this.pendingTerminalDispositions.get(runId) ?? 'interrupted';
        const outcome = await this.dependencies.schedules.consumeClaimed({
          scheduleId: schedule.scheduleId,
          runId,
          consumedAt: this.dependencies.now().toISOString(),
          completionDisposition,
        });
        if (outcome.status === 'consumed') {
          recovered += 1;
          this.pendingTerminalDispositions.delete(runId);
        } else if (outcome.status === 'already_terminal') {
          alreadyTerminal += 1;
          this.pendingTerminalDispositions.delete(runId);
        } else {
          throw new Error(
            `AI Schedule claimed recovery ${schedule.scheduleId} 失败：${outcome.status}`,
          );
        }
      }

      return {
        mode,
        examined: claimed.length,
        skippedActive,
        recovered,
        alreadyTerminal,
      };
    });
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(task, task);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function isClaimedOutcome(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && (value as { status?: unknown }).status === 'claimed';
}

function requireClaimedRunId(schedule: AISchedule): string {
  if (schedule.status !== 'claimed' || !schedule.claimedByRunId) {
    throw new Error(`AI Schedule recovery 收到非法 claimed snapshot：${schedule.scheduleId}`);
  }
  return schedule.claimedByRunId;
}

const aiScheduleRecovery = new AIScheduleRecovery({
  get schedules() {
    return getCompanionRuntimeDependencies().repositories.aiSchedules;
  },
  now: () => new Date(),
});

export function claimAndTrackAIScheduleRun<T>(
  runId: string,
  claim: () => Promise<T>,
): Promise<T> {
  return aiScheduleRecovery.claimAndTrack(runId, claim);
}

export function completeTrackedAIScheduleRun<T>(
  runId: string,
  completionDisposition: AIScheduleCompletionDisposition,
  consume: () => Promise<T>,
): Promise<T> {
  return aiScheduleRecovery.completeTrackedRun(runId, completionDisposition, consume);
}

/** Host startup / foreground recovery 的唯一组合入口。 */
export function recoverAIScheduleClaims(
  mode: AIScheduleRecoveryMode,
): Promise<AIScheduleRecoveryResult> {
  return aiScheduleRecovery.recover(mode);
}
