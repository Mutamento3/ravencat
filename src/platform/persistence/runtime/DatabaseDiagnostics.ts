/** SQLite 调度与事务诊断，日志字段稳定供真机冷启动排障。 */

import type { DatabaseTaskMeta } from './DatabaseTask';

export type DatabaseTaskKind = 'read' | 'write' | 'transaction' | 'barrier';
export type DatabaseTaskOutcome = 'committed' | 'rolled_back' | 'completed' | 'failed';

export interface DatabaseDiagnosticEvent {
  taskId?: string;
  operation: string;
  feature: string;
  priority: DatabaseTaskMeta['priority'];
  kind: DatabaseTaskKind;
  traceId?: string;
  transactionId?: string;
  queuedAt: string;
  startedAt?: string;
  committedAt?: string;
  rolledBackAt?: string;
  completedAt?: string;
  queueWaitMs?: number;
  /**
   * 任务自身墙钟耗时总量（不含排队等待），等于
   * connectionAcquireMs + operationDurationMs + 调度间隙。
   */
  durationMs?: number;
  /**
   * 取得数据库连接（getDB）所花时间。区分“第一次打开连接 / 等待正在进行的 open”
   * 与真实 SQL 执行，避免把连接获取误判成 SQL 慢。
   * barrier 等不访问连接的任务为 undefined。
   */
  connectionAcquireMs?: number;
  /**
   * 拿到连接后，真正交给 SQLite 的工作耗时：单条 SQL、事务作用域或备份。
   * undefined 表示该任务没有可观测的操作阶段。
   */
  operationDurationMs?: number;
  /**
   * task 总耗时中未落在连接获取或 SQLite 操作阶段的部分，主要是 async continuation
   * 等待 JS 线程重新执行。该值高说明拥堵不应归因于 SQL 扫描。
   */
  continuationDelayMs?: number;
  outcome?: DatabaseTaskOutcome;
  error?: unknown;
}

export type DatabaseDiagnosticListener = (event: DatabaseDiagnosticEvent) => void;

const SLOW_TASK_THRESHOLD_MS = 100;
const SLOW_TASK_BATCH_WINDOW_MS = 500;

interface SlowOperationSummary {
  operation: string;
  feature: string;
  priority: DatabaseTaskMeta['priority'];
  kind: DatabaseTaskKind;
  count: number;
  maxQueueWaitMs: number;
  maxDurationMs: number;
  maxConnectionAcquireMs: number;
  maxOperationDurationMs: number;
  maxContinuationDelayMs: number;
  sampleTaskId?: string;
  sampleTransactionId?: string;
}

let slowTaskBatch: DatabaseDiagnosticEvent[] = [];
let slowTaskBatchTimer: ReturnType<typeof setTimeout> | null = null;

function flushSlowTaskBatch(): void {
  slowTaskBatchTimer = null;
  const events = slowTaskBatch;
  slowTaskBatch = [];
  if (events.length === 0) {
    return;
  }

  const summaries = new Map<string, SlowOperationSummary>();
  for (const event of events) {
    const key = `${event.feature}\u0000${event.operation}\u0000${event.priority}\u0000${event.kind}`;
    const current = summaries.get(key);
    if (current) {
      current.count += 1;
      current.maxQueueWaitMs = Math.max(current.maxQueueWaitMs, event.queueWaitMs ?? 0);
      current.maxDurationMs = Math.max(current.maxDurationMs, event.durationMs ?? 0);
      current.maxConnectionAcquireMs = Math.max(
        current.maxConnectionAcquireMs,
        event.connectionAcquireMs ?? 0,
      );
      current.maxOperationDurationMs = Math.max(
        current.maxOperationDurationMs,
        event.operationDurationMs ?? 0,
      );
      current.maxContinuationDelayMs = Math.max(
        current.maxContinuationDelayMs,
        event.continuationDelayMs ?? 0,
      );
      continue;
    }
    summaries.set(key, {
      operation: event.operation,
      feature: event.feature,
      priority: event.priority,
      kind: event.kind,
      count: 1,
      maxQueueWaitMs: event.queueWaitMs ?? 0,
      maxDurationMs: event.durationMs ?? 0,
      maxConnectionAcquireMs: event.connectionAcquireMs ?? 0,
      maxOperationDurationMs: event.operationDurationMs ?? 0,
      maxContinuationDelayMs: event.continuationDelayMs ?? 0,
      sampleTaskId: event.taskId,
      sampleTransactionId: event.transactionId,
    });
  }

  const operations = Array.from(summaries.values()).sort((left, right) => (
    Math.max(right.maxQueueWaitMs, right.maxDurationMs)
    - Math.max(left.maxQueueWaitMs, left.maxDurationMs)
  ));
  const finishedAt = events
    .map((event) => event.committedAt ?? event.completedAt ?? event.startedAt ?? event.queuedAt)
    .sort()
    .at(-1);

  console.warn('[SQLiteCoordinator][SlowBatch]', {
    taskCount: events.length,
    operationCount: operations.length,
    maxQueueWaitMs: Math.max(...events.map((event) => event.queueWaitMs ?? 0)),
    maxDurationMs: Math.max(...events.map((event) => event.durationMs ?? 0)),
    maxConnectionAcquireMs: Math.max(...events.map((event) => event.connectionAcquireMs ?? 0)),
    maxOperationDurationMs: Math.max(...events.map((event) => event.operationDurationMs ?? 0)),
    maxContinuationDelayMs: Math.max(...events.map((event) => event.continuationDelayMs ?? 0)),
    firstQueuedAt: events.map((event) => event.queuedAt).sort()[0],
    finishedAt,
    operations,
  });
}

function enqueueSlowTask(event: DatabaseDiagnosticEvent): void {
  slowTaskBatch.push(event);
  if (slowTaskBatchTimer === null) {
    slowTaskBatchTimer = setTimeout(flushSlowTaskBatch, SLOW_TASK_BATCH_WINDOW_MS);
  }
}

let listener: DatabaseDiagnosticListener = (event) => {
  if (event.outcome === 'failed' || event.outcome === 'rolled_back') {
    console.warn('[SQLiteCoordinator]', event);
    return;
  }

  const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
  const isTerminal = event.outcome === 'completed' || event.outcome === 'committed';
  const isSlow = (event.queueWaitMs ?? 0) > SLOW_TASK_THRESHOLD_MS
    || (event.durationMs ?? 0) > SLOW_TASK_THRESHOLD_MS;
  if (isDevelopment && isTerminal && isSlow) {
    enqueueSlowTask(event);
  }
};

export function emitDatabaseDiagnostic(event: DatabaseDiagnosticEvent): void {
  listener(event);
}

/** 仅供契约测试或宿主诊断替换输出目标。 */
export function setDatabaseDiagnosticListener(next: DatabaseDiagnosticListener): () => void {
  const previous = listener;
  listener = next;
  return () => {
    listener = previous;
  };
}
