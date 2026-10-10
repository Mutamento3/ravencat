/** 保留原始异常与任务元数据，避免 finalizeAsync 遮蔽最初操作。 */

import type { DatabaseTaskMeta } from './DatabaseTask';

export type DatabaseErrorKind = 'busy' | 'locked' | 'constraint' | 'connection' | 'unknown';

export class CoordinatedDatabaseError extends Error {
  readonly kind: DatabaseErrorKind;
  readonly task: DatabaseTaskMeta;
  override readonly cause: unknown;

  constructor(kind: DatabaseErrorKind, task: DatabaseTaskMeta, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`[${task.feature}:${task.name}] ${detail}`);
    this.name = 'CoordinatedDatabaseError';
    this.kind = kind;
    this.task = task;
    this.cause = cause;
  }
}

export function classifyDatabaseError(error: unknown): DatabaseErrorKind {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes('database is locked') || message.includes('sqlite_locked')) return 'locked';
  if (message.includes('database is busy') || message.includes('sqlite_busy')) return 'busy';
  if (message.includes('constraint')) return 'constraint';
  if (message.includes('closed') || message.includes('cannot open')) return 'connection';
  return 'unknown';
}
