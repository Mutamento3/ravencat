/** 全局 SQLite 读写调度器：有界读取、单写者、优先级与等待时长提升。 */

import type { DatabaseTaskMeta } from './DatabaseTask';

type ScheduledKind = 'read' | 'write' | 'barrier';

interface ScheduledTask<T> {
  sequence: number;
  kind: ScheduledKind;
  meta: DatabaseTaskMeta;
  queuedAtMs: number;
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

const PRIORITY_WEIGHT: Record<DatabaseTaskMeta['priority'], number> = {
  bootstrap: 5,
  surface: 4,
  interactive: 3,
  runtime: 2,
  maintenance: 1,
};

export interface DatabaseTaskSchedulerOptions {
  maxConcurrentReads?: number;
  agingIntervalMs?: number;
  now?: () => number;
}

export class DatabaseTaskScheduler {
  private readonly maxConcurrentReads: number;
  private readonly agingIntervalMs: number;
  private readonly now: () => number;
  private readonly queue: ScheduledTask<unknown>[] = [];
  private sequence = 0;
  private activeReads = 0;
  private activeWrite = false;

  constructor(options: DatabaseTaskSchedulerOptions = {}) {
    this.maxConcurrentReads = options.maxConcurrentReads ?? 2;
    this.agingIntervalMs = options.agingIntervalMs ?? 5_000;
    this.now = options.now ?? Date.now;
  }

  scheduleRead<T>(meta: DatabaseTaskMeta, run: () => Promise<T>): Promise<T> {
    return this.enqueue('read', meta, run);
  }

  scheduleWrite<T>(meta: DatabaseTaskMeta, run: () => Promise<T>): Promise<T> {
    return this.enqueue('write', meta, run);
  }

  scheduleBarrier<T>(meta: DatabaseTaskMeta, run: () => Promise<T>): Promise<T> {
    return this.enqueue('barrier', meta, run);
  }

  private enqueue<T>(kind: ScheduledKind, meta: DatabaseTaskMeta, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        sequence: this.sequence++,
        kind,
        meta,
        queuedAtMs: this.now(),
        run,
        resolve,
        reject,
      } as ScheduledTask<unknown>);
      this.drain();
    });
  }

  private drain(): void {
    if (this.activeWrite || this.queue.length === 0) return;

    if (this.activeReads > 0) {
      if (this.queue.some((task) => task.kind !== 'read')) return;
      while (this.activeReads < this.maxConcurrentReads) {
        const task = this.takeNext('read');
        if (!task) break;
        this.startRead(task);
      }
      return;
    }

    const next = this.takeNext();
    if (!next) return;
    if (next.kind !== 'read') {
      this.startWrite(next);
      return;
    }

    this.startRead(next);
    while (this.activeReads < this.maxConcurrentReads && !this.queue.some((task) => task.kind !== 'read')) {
      const read = this.takeNext('read');
      if (!read) break;
      this.startRead(read);
    }
  }

  private takeNext(kind?: ScheduledKind): ScheduledTask<unknown> | undefined {
    const now = this.now();
    const earliestBarrierSequence = this.queue
      .filter((task) => task.kind === 'barrier')
      .reduce((earliest, task) => Math.min(earliest, task.sequence), Number.POSITIVE_INFINITY);
    let selectedIndex = -1;
    let selectedScore = -1;
    let selectedSequence = Number.POSITIVE_INFINITY;

    this.queue.forEach((task, index) => {
      if (kind && task.kind !== kind) return;
      if (task.sequence > earliestBarrierSequence) return;
      const barrierReady = task.kind === 'barrier'
        && !this.queue.some((candidate) => candidate.sequence < task.sequence);
      if (task.kind === 'barrier' && !barrierReady) return;
      const age = Math.floor((now - task.queuedAtMs) / this.agingIntervalMs);
      const score = barrierReady ? Number.POSITIVE_INFINITY : PRIORITY_WEIGHT[task.meta.priority] + age;
      if (score > selectedScore || (score === selectedScore && task.sequence < selectedSequence)) {
        selectedIndex = index;
        selectedScore = score;
        selectedSequence = task.sequence;
      }
    });

    if (selectedIndex < 0) return undefined;
    return this.queue.splice(selectedIndex, 1)[0];
  }

  private startRead(task: ScheduledTask<unknown>): void {
    this.activeReads += 1;
    void task.run().then(task.resolve, task.reject).finally(() => {
      this.activeReads -= 1;
      this.drain();
    });
  }

  private startWrite(task: ScheduledTask<unknown>): void {
    this.activeWrite = true;
    void task.run().then(task.resolve, task.reject).finally(() => {
      this.activeWrite = false;
      this.drain();
    });
  }
}
