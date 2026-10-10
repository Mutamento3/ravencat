/** SQLite 调度任务的公共契约。 */

export type DatabaseTaskPriority =
  | 'bootstrap'
  | 'surface'
  | 'interactive'
  | 'runtime'
  | 'maintenance';

export interface DatabaseTaskMeta {
  name: string;
  priority: DatabaseTaskPriority;
  feature: string;
  traceId?: string;
}

export interface DatabaseReadTaskMeta extends DatabaseTaskMeta {
  consistency?: 'snapshot' | 'after-prior-writes';
}

export interface DatabaseWriteTaskMeta extends DatabaseTaskMeta {
  retry?: {
    mode: 'none' | 'idempotent';
    idempotencyKey?: string;
  };
}
