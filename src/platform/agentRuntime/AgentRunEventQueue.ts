/** 串行消费 Agent 事件，并合并待处理的纯文本增量，避免慢投影丢失终止事件。 */
import type { AgentRunEvent, AgentRunEventSink } from './AgentRunEvent';

type DeltaEvent = Extract<AgentRunEvent, { type: 'reasoning_delta' | 'assistant_text_delta' }>;

interface QueueEntry {
  event: AgentRunEvent;
  completion: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null;
}

export class AgentRunEventQueue {
  private readonly pending: QueueEntry[] = [];
  private consuming = false;
  private failure: unknown = null;
  private drainWaiters: {
    resolve: () => void;
    reject: (error: unknown) => void;
  }[] = [];

  constructor(private readonly sink: AgentRunEventSink) {}

  enqueue(event: AgentRunEvent): Promise<void> {
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }

    const lastEntry = this.pending[this.pending.length - 1];
    const lastEvent = lastEntry?.event;
    if (isDeltaEvent(event) && isMergeableDelta(lastEvent, event)) {
      const previousDelta = lastEvent;
      lastEntry.event = {
        ...previousDelta,
        text: previousDelta.text + event.text,
      } as DeltaEvent;
      return Promise.resolve();
    }
    const completion = isDeltaEvent(event) ? null : createQueueCompletion();
    this.pending.push({
      event,
      completion,
    });
    this.consume();
    return completion?.promise ?? Promise.resolve();
  }

  async drain(): Promise<void> {
    if (!this.consuming && this.pending.length === 0) {
      this.throwIfFailed();
      return;
    }

    await new Promise<void>((resolve, reject) => {
      this.drainWaiters.push({ resolve, reject });
    });
    this.throwIfFailed();
  }

  private consume(): void {
    if (this.consuming) {
      return;
    }
    this.consuming = true;
    void this.consumePending();
  }

  private async consumePending(): Promise<void> {
    let activeEntry: QueueEntry | null = null;
    try {
      while (this.pending.length > 0) {
        activeEntry = this.pending.shift()!;
        await this.sink(activeEntry.event);
        activeEntry.completion?.resolve();
        activeEntry = null;
      }
    } catch (error) {
      this.failure = error;
      activeEntry?.completion?.reject(error);
      const failedEntries = this.pending.splice(0);
      for (const entry of failedEntries) {
        entry.completion?.reject(error);
      }
    } finally {
      this.consuming = false;
      if (this.pending.length > 0 && this.failure === null) {
        this.consume();
        return;
      }
      const waiters = this.drainWaiters;
      this.drainWaiters = [];
      for (const waiter of waiters) {
        if (this.failure === null) {
          waiter.resolve();
        } else {
          waiter.reject(this.failure);
        }
      }
    }
  }

  private throwIfFailed(): void {
    if (this.failure !== null) {
      throw this.failure;
    }
  }
}

function createQueueCompletion(): {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
} {
  let resolveCompletion!: () => void;
  let rejectCompletion!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });
  return {
    promise,
    resolve: resolveCompletion,
    reject: rejectCompletion,
  };
}

function isMergeableDelta(
  previous: AgentRunEvent | undefined,
  next: AgentRunEvent
): previous is DeltaEvent {
  if (!previous || !isDeltaEvent(previous) || !isDeltaEvent(next)) {
    return false;
  }
  return previous.type === next.type
    && previous.runId === next.runId
    && previous.stepIndex === next.stepIndex;
}

function isDeltaEvent(event: AgentRunEvent): event is DeltaEvent {
  return event.type === 'reasoning_delta' || event.type === 'assistant_text_delta';
}
