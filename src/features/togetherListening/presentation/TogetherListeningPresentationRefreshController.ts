export interface TogetherListeningPresentationScheduler {
  setInterval(callback: () => void, cadenceMs: number): unknown;
  clearInterval(handle: unknown): void;
}

interface RefreshControllerOptions {
  cadenceMs: number;
  refresh: () => Promise<boolean>;
  scheduler: TogetherListeningPresentationScheduler;
}

/** 只管理 UI 刷新节奏；返回值表示最新 canonical presentation 是否 active。 */
export class TogetherListeningPresentationRefreshController {
  private foreground = false;
  private presentationActive = false;
  private stopped = false;
  private inFlight = false;
  private refreshQueued = false;
  private intervalHandle: unknown = null;

  constructor(private readonly options: RefreshControllerOptions) {}

  start(foreground: boolean): void {
    this.stopped = false;
    this.foreground = foreground;
    if (foreground) void this.refresh();
  }

  setForeground(foreground: boolean): void {
    const resumed = foreground && !this.foreground;
    this.foreground = foreground;
    this.syncInterval();
    if (resumed) void this.refresh();
  }

  invalidate(): void {
    if (this.foreground) void this.refresh();
  }

  stop(): void {
    this.stopped = true;
    this.clearInterval();
  }

  private async refresh(): Promise<void> {
    if (this.stopped || !this.foreground) return;
    if (this.inFlight) {
      this.refreshQueued = true;
      return;
    }
    this.inFlight = true;
    try {
      this.presentationActive = await this.options.refresh();
    } finally {
      this.inFlight = false;
      this.syncInterval();
      if (this.refreshQueued && !this.stopped && this.foreground) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private syncInterval(): void {
    const shouldPoll = !this.stopped && this.foreground && this.presentationActive;
    if (shouldPoll && this.intervalHandle === null) {
      this.intervalHandle = this.options.scheduler.setInterval(
        () => void this.refresh(),
        this.options.cadenceMs,
      );
    } else if (!shouldPoll) {
      this.clearInterval();
    }
  }

  private clearInterval(): void {
    if (this.intervalHandle === null) return;
    this.options.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
