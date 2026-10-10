/**
 * AI Schedule native projection 的进程内恢复协调器。
 *
 * SQLite durable schedule 仍是唯一业务真值；这里仅合并恢复请求并安排
 * 一次性的 bounded retry，不保存任何 schedule 业务状态。每次真正恢复时
 * 都由 owner 重新读取当前 SQLite truth。
 */

export interface AIScheduleProjectionRepairCoordinatorDependencies<TOutcome> {
  reconcile(): Promise<TOutcome>;
  isHealthy(outcome: TOutcome): boolean;
}

export interface AIScheduleProjectionRepairCoordinatorOptions {
  /** 便于行为测试注入 deterministic timer；生产环境使用全局 timer。 */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export const AISCHEDULE_PROJECTION_RETRY_DELAYS_MS = [
  1_000,
  5_000,
  30_000,
  60_000,
] as const;

export class AIScheduleProjectionRepairCoordinator<TOutcome> {
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<TOutcome> | null = null;
  private repairRequested = false;
  /** 当前恢复轮次下一次 timer 对应的 delay index。 */
  private retryIndex = 0;
  private retryExhausted = false;
  private retryAfterRun = false;
  private generation = 0;
  private suspended = false;

  constructor(
    private readonly dependencies: AIScheduleProjectionRepairCoordinatorDependencies<TOutcome>,
    options: AIScheduleProjectionRepairCoordinatorOptions = {},
  ) {
    this.setTimer = options.setTimeout ?? setTimeout;
    this.clearTimer = options.clearTimeout ?? clearTimeout;
  }

  /** 合并所有 lifecycle / commit 后失败通知，不为每个 schedule 建立队列。 */
  requestRepair(): void {
    if (this.suspended) return;
    // 没有 in-flight / timer 时，说明上一轮 bounded retry 已结束；新的明确
    // commit 后失败应开启新一轮，而不是让 retry 永久停在 exhausted 状态。
    if (!this.inFlight && !this.retryTimer && this.retryExhausted) {
      this.retryIndex = 0;
      this.retryExhausted = false;
    }
    this.repairRequested = true;
    if (this.inFlight || this.retryTimer) return;
    this.scheduleRetry();
  }

  /** 冷启动或前台恢复触发：若已有运行中的 reconcile，则复用同一个 Promise。 */
  reconcileNow(): Promise<TOutcome> {
    this.suspended = false;
    this.repairRequested = true;
    // lifecycle 是明确的新恢复机会；清除上一轮退避进度。
    this.retryIndex = 0;
    this.retryExhausted = false;
    this.retryAfterRun = false;
    this.clearRetryTimer();
    if (this.inFlight) return this.inFlight;
    return this.startRun(false);
  }

  /**
   * 恢复出厂前停止未来 timer，并让已开始的 reconcile 完成后不再重新排队。
   * reset 若需要等待当前恢复访问 SQLite，应调用 drainAndCancel。
   */
  cancel(): void {
    this.generation += 1;
    this.suspended = true;
    this.repairRequested = false;
    this.retryAfterRun = false;
    this.retryIndex = 0;
    this.retryExhausted = false;
    this.clearRetryTimer();
  }

  async drainAndCancel(): Promise<void> {
    this.cancel();
    const inFlight = this.inFlight;
    if (!inFlight) return;
    await inFlight.catch(() => undefined);
  }

  private startRun(fromRetry: boolean): Promise<TOutcome> {
    const runGeneration = this.generation;
    const run = (async () => {
      try {
        const outcome = await this.dependencies.reconcile();
        if (runGeneration !== this.generation) return outcome;
        if (this.dependencies.isHealthy(outcome)) {
          this.repairRequested = false;
          this.retryIndex = 0;
          this.retryExhausted = false;
          this.retryAfterRun = false;
          this.clearRetryTimer();
        } else {
          this.markRepairNeeded(runGeneration, fromRetry);
        }
        return outcome;
      } catch (error) {
        if (runGeneration === this.generation) this.markRepairNeeded(runGeneration, fromRetry);
        throw error;
      } finally {
        if (this.inFlight === run) this.inFlight = null;
        if (runGeneration === this.generation && this.retryAfterRun) {
          this.retryAfterRun = false;
          this.scheduleRetry();
        }
      }
    })();
    this.inFlight = run;
    return run;
  }

  private markRepairNeeded(runGeneration: number, fromRetry: boolean): void {
    if (runGeneration !== this.generation || this.suspended) return;
    this.repairRequested = true;
    if (fromRetry) {
      if (this.retryIndex >= AISCHEDULE_PROJECTION_RETRY_DELAYS_MS.length - 1) {
        this.retryExhausted = true;
        this.retryAfterRun = false;
        return;
      }
      this.retryIndex += 1;
    } else if (this.retryIndex >= AISCHEDULE_PROJECTION_RETRY_DELAYS_MS.length - 1) {
      this.retryExhausted = true;
      this.retryAfterRun = false;
      return;
    }
    this.retryAfterRun = true;
  }

  private scheduleRetry(): void {
    if (
      this.suspended
      || !this.repairRequested
      || this.retryExhausted
      || this.retryTimer
      || this.inFlight
    ) return;
    const delay = AISCHEDULE_PROJECTION_RETRY_DELAYS_MS[this.retryIndex];
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null;
      if (this.suspended || !this.repairRequested || this.inFlight) return;
      void this.startRun(true).catch(() => {
        // 失败已经由 startRun 安排下一次 bounded retry；timer 回调不产生未处理 rejection。
      });
    }, delay);
    // Node verifier 不应被 60s 的进程内恢复 timer 阻塞退出；RN timer 没有 unref。
    const unref = (this.retryTimer as unknown as { unref?: () => void }).unref;
    unref?.call(this.retryTimer);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    this.clearTimer(this.retryTimer);
    this.retryTimer = null;
  }
}
