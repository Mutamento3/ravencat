export function getTogetherListeningElapsedMs(
  activatedAtEpochMs: number,
  nowEpochMs: number,
): number {
  return Math.max(0, nowEpochMs - activatedAtEpochMs);
}

export function formatTogetherListeningDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(totalMinutes)}:${pad(seconds)}`;
}

export interface TogetherListeningDurationScheduler {
  setInterval(callback: () => void, cadenceMs: number): unknown;
  clearInterval(handle: unknown): void;
}

interface TogetherListeningDurationTickerOptions {
  cadenceMs: number;
  nowEpochMs: () => number;
  onElapsedMs: (elapsedMs: number | null) => void;
  scheduler: TogetherListeningDurationScheduler;
}

/** 只推进 presentation 时钟；不读取媒体、数据库或 Activity。 */
export class TogetherListeningDurationTicker {
  private intervalHandle: unknown = null;
  private activatedAtEpochMs: number | null = null;

  constructor(private readonly options: TogetherListeningDurationTickerOptions) {}

  update(activatedAtEpochMs: number | null, foreground: boolean): void {
    this.clearInterval();
    this.activatedAtEpochMs = activatedAtEpochMs;
    this.emitElapsed();
    if (activatedAtEpochMs !== null && foreground) {
      this.intervalHandle = this.options.scheduler.setInterval(
        () => this.emitElapsed(),
        this.options.cadenceMs,
      );
    }
  }

  stop(): void {
    this.activatedAtEpochMs = null;
    this.clearInterval();
  }

  private emitElapsed(): void {
    this.options.onElapsedMs(
      this.activatedAtEpochMs === null
        ? null
        : getTogetherListeningElapsedMs(
            this.activatedAtEpochMs,
            this.options.nowEpochMs(),
          ),
    );
  }

  private clearInterval(): void {
    if (this.intervalHandle === null) return;
    this.options.scheduler.clearInterval(this.intervalHandle);
    this.intervalHandle = null;
  }
}
