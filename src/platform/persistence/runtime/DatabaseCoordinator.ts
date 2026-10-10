/** 全应用唯一 SQLite 协调器。 */

import type { SQLiteBindParams, SQLiteRunResult } from 'expo-sqlite';
import * as SQLite from 'expo-sqlite';
import { getDB } from '../sqlite/connection';
import { CoordinatedDatabaseError, classifyDatabaseError } from './DatabaseErrors';
import { emitDatabaseDiagnostic } from './DatabaseDiagnostics';
import type { DatabaseDiagnosticEvent, DatabaseTaskKind } from './DatabaseDiagnostics';
import { DatabaseTaskScheduler } from './DatabaseTaskScheduler';
import type { DatabaseReadTaskMeta, DatabaseTaskMeta, DatabaseWriteTaskMeta } from './DatabaseTask';

export interface DatabaseReadExecutor {
  getFirstAsync<T>(source: string, params?: SQLiteBindParams): Promise<T | null>;
  getAllAsync<T>(source: string, params?: SQLiteBindParams): Promise<T[]>;
}

export interface DatabaseWriteExecutor extends DatabaseReadExecutor {
  runAsync(source: string, params?: SQLiteBindParams): Promise<SQLiteRunResult>;
  execAsync(source: string): Promise<void>;
}

export type DatabaseTransactionExecutor = DatabaseWriteExecutor;

export interface CoordinatedDatabaseExecutor extends DatabaseWriteExecutor {
  withExclusiveTransactionAsync<T>(task: (tx: DatabaseTransactionExecutor) => Promise<T>): Promise<T>;
  /**
   * 独占写作用域：整个 callback 作为调度器中的单个 write task 执行，
   * 持续期间其他 read/write/transaction/barrier 均不得插入。
   * 不会自动执行 SQLite BEGIN，callback 直接拿到底层数据库执行器。
   */
  withExclusiveWriteScopeAsync<T>(
    task: (database: DatabaseWriteExecutor) => Promise<T>,
  ): Promise<T>;
}

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

/**
 * 单个调度任务的耗时拆解。由 schedule 创建，交给具体任务填充。
 *
 * 存在的意义：`durationMs` 只回答“这个 task 花了多久”，无法回答“慢在取连接还是慢在 SQL”。
 * 只有把 getDB 与真实 SQLite 操作分开计时，才能避免把首次打开连接或等待中的 open
 * 误判成 SQL 慢，进而错误地去优化一条本来很快的语句。
 */
interface DatabaseTaskTiming {
  connectionAcquireMs?: number;
  operationDurationMs?: number;
}

function shouldMeasureTaskTiming(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

async function acquireDatabase(
  timing?: DatabaseTaskTiming,
): Promise<Awaited<ReturnType<typeof getDB>>> {
  if (!timing) {
    return getDB();
  }
  const startedAtMs = Date.now();
  const database = await getDB();
  timing.connectionAcquireMs = Date.now() - startedAtMs;
  return database;
}

async function runDatabaseOperation<T>(
  timing: DatabaseTaskTiming | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!timing) {
    return operation();
  }
  const startedAtMs = Date.now();
  try {
    return await operation();
  } finally {
    timing.operationDurationMs = Date.now() - startedAtMs;
  }
}

function describeTiming(
  timing?: DatabaseTaskTiming,
  totalDurationMs?: number,
): Pick<
  DatabaseDiagnosticEvent,
  'connectionAcquireMs' | 'operationDurationMs' | 'continuationDelayMs'
> {
  const fields: Pick<
    DatabaseDiagnosticEvent,
    'connectionAcquireMs' | 'operationDurationMs' | 'continuationDelayMs'
  > = {};
  if (!timing) {
    return fields;
  }
  if (timing.connectionAcquireMs !== undefined) {
    fields.connectionAcquireMs = timing.connectionAcquireMs;
  }
  if (timing.operationDurationMs !== undefined) {
    fields.operationDurationMs = timing.operationDurationMs;
  }
  if (
    totalDurationMs !== undefined
    && timing.connectionAcquireMs !== undefined
    && timing.operationDurationMs !== undefined
  ) {
    fields.continuationDelayMs = Math.max(
      0,
      totalDurationMs - timing.connectionAcquireMs - timing.operationDurationMs,
    );
  }
  return fields;
}

export class DatabaseCoordinator {
  private readonly scheduler: DatabaseTaskScheduler;
  private taskSequence = 0;
  private transactionSequence = 0;

  constructor(scheduler = new DatabaseTaskScheduler()) {
    this.scheduler = scheduler;
  }

  /**
   * 为一个 Repository 操作绑定元数据。每条非事务 SQL 仍由全局调度器裁决；
   * 原子组合必须进入 withExclusiveTransactionAsync。
   */
  openTaskExecutor(meta: DatabaseTaskMeta): CoordinatedDatabaseExecutor {
    const readMeta: DatabaseReadTaskMeta = meta;
    const writeMeta: DatabaseWriteTaskMeta = meta;
    const executor: CoordinatedDatabaseExecutor = {
      getFirstAsync: <T>(source: string, params?: SQLiteBindParams) => (
        this.read(readMeta, (db) => db.getFirstAsync<T>(source, params))
      ),
      getAllAsync: <T>(source: string, params?: SQLiteBindParams) => (
        this.read(readMeta, (db) => db.getAllAsync<T>(source, params))
      ),
      runAsync: (source: string, params?: SQLiteBindParams) => (
        this.write(writeMeta, (db) => db.runAsync(source, params))
      ),
      execAsync: (source: string) => this.write(writeMeta, (db) => db.execAsync(source)),
      withExclusiveTransactionAsync: <T>(task: (tx: DatabaseTransactionExecutor) => Promise<T>) => (
        this.transaction(writeMeta, task)
      ),
      withExclusiveWriteScopeAsync: <T>(task: (database: DatabaseWriteExecutor) => Promise<T>) => (
        this.write(writeMeta, (db) => task(db))
      ),
    };
    return executor;
  }

  read<T>(meta: DatabaseReadTaskMeta, task: (db: DatabaseReadExecutor) => Promise<T>): Promise<T> {
    return this.schedule('read', meta, async (timing) => {
      const database = await acquireDatabase(timing);
      return runDatabaseOperation(timing, () => task(database));
    });
  }

  write<T>(meta: DatabaseWriteTaskMeta, task: (db: DatabaseWriteExecutor) => Promise<T>): Promise<T> {
    return this.schedule('write', meta, async (timing) => {
      const database = await acquireDatabase(timing);
      return runDatabaseOperation(timing, () => task(database));
    });
  }

  transaction<T>(
    meta: DatabaseWriteTaskMeta,
    task: (tx: DatabaseTransactionExecutor) => Promise<T>,
  ): Promise<T> {
    const transactionId = `tx-${Date.now()}-${this.transactionSequence++}`;
    return this.schedule('transaction', meta, async (timing) => {
      const db = await acquireDatabase(timing);
      return runDatabaseOperation(timing, async () => {
        // 调度器已排空读取并独占写入；复用已配置的 canonical 连接即可隔离事务。
        // Expo 独占事务另开连接，不继承 foreign_keys，导致删除父记录时遗漏级联清理。
        await db.execAsync('BEGIN IMMEDIATE;');
        try {
          const value = await task(db);
          await db.execAsync('COMMIT;');
          return value;
        } catch (error) {
          await db.execAsync('ROLLBACK;');
          throw error;
        }
      });
    }, transactionId);
  }

  async barrier(meta: DatabaseTaskMeta): Promise<void> {
    await this.schedule('barrier', meta, async () => undefined);
  }

  /** 快照与 restore staging 只能通过只读 executor 查询，不向 Feature 暴露第二个连接。 */
  readSnapshotAsync<T>(meta: DatabaseReadTaskMeta, uri: string, task: (executor: DatabaseReadExecutor) => Promise<T>): Promise<T> {
    return this.schedule('read', meta, async () => {
      const separator = uri.lastIndexOf('/');
      const snapshot = await SQLite.openDatabaseAsync(uri.slice(separator + 1), { useNewConnection: true }, uri.slice(0, separator + 1));
      try {
        return await task({
          getFirstAsync: <Row>(sql: string, params?: SQLiteBindParams) => snapshot.getFirstAsync<Row>(sql, params),
          getAllAsync: <Row>(sql: string, params?: SQLiteBindParams) => snapshot.getAllAsync<Row>(sql, params),
        });
      } finally {
        await snapshot.closeAsync();
      }
    });
  }

  /**
   * 在全局写调度器内生成一致的 SQLite 快照。
   * 目标连接只在平台层存在，业务 Feature 不会获得活动数据库连接。
   */
  async backupToAsync(
    meta: DatabaseWriteTaskMeta,
    destinationName: string,
    destinationDirectory: string,
    prepareSnapshot?: (executor: DatabaseWriteExecutor) => Promise<void>,
  ): Promise<void> {
    await this.schedule('write', meta, async (timing) => {
      const sourceDatabase = await acquireDatabase(timing);
      await runDatabaseOperation(timing, async () => {
        const destinationDatabase = await SQLite.openDatabaseAsync(
          destinationName,
          undefined,
          destinationDirectory,
        );
        try {
          await SQLite.backupDatabaseAsync({ sourceDatabase, destDatabase: destinationDatabase });
          if (prepareSnapshot) await prepareSnapshot({
            getFirstAsync: <Row>(sql: string, params?: SQLiteBindParams) => destinationDatabase.getFirstAsync<Row>(sql, params),
            getAllAsync: <Row>(sql: string, params?: SQLiteBindParams) => destinationDatabase.getAllAsync<Row>(sql, params),
            runAsync: (sql: string, params?: SQLiteBindParams) => destinationDatabase.runAsync(sql, params),
            execAsync: (sql: string) => destinationDatabase.execAsync(sql),
          });
        } finally {
          await destinationDatabase.closeAsync();
        }
      });
    });
  }

  private schedule<T>(
    kind: DatabaseTaskKind,
    meta: DatabaseTaskMeta,
    task: (timing?: DatabaseTaskTiming) => Promise<T>,
    transactionId?: string,
  ): Promise<T> {
    const taskId = `db-task-${Date.now()}-${this.taskSequence++}`;
    const queuedAtMs = Date.now();
    const queuedAt = timestamp(queuedAtMs);
    emitDatabaseDiagnostic({
      taskId,
      operation: meta.name,
      feature: meta.feature,
      priority: meta.priority,
      kind,
      traceId: meta.traceId,
      transactionId,
      queuedAt,
    });

    const run = async (): Promise<T> => {
      const startedAtMs = Date.now();
      const startedAt = timestamp(startedAtMs);
      const queueWaitMs = startedAtMs - queuedAtMs;
      emitDatabaseDiagnostic({
        taskId,
        operation: meta.name,
        feature: meta.feature,
        priority: meta.priority,
        kind,
        traceId: meta.traceId,
        transactionId,
        queuedAt,
        startedAt,
        queueWaitMs,
      });
      const timing: DatabaseTaskTiming | undefined = shouldMeasureTaskTiming() ? {} : undefined;
      try {
        const result = await task(timing);
        const endedAtMs = Date.now();
        const durationMs = endedAtMs - startedAtMs;
        const committedAt = kind === 'transaction' ? timestamp(endedAtMs) : undefined;
        emitDatabaseDiagnostic({
          taskId,
          operation: meta.name,
          feature: meta.feature,
          priority: meta.priority,
          kind,
          traceId: meta.traceId,
          transactionId,
          queuedAt,
          startedAt,
          committedAt,
          completedAt: kind === 'transaction' ? undefined : timestamp(endedAtMs),
          queueWaitMs,
          durationMs,
          ...describeTiming(timing, durationMs),
          outcome: kind === 'transaction' ? 'committed' : 'completed',
        });
        return result;
      } catch (error) {
        const endedAtMs = Date.now();
        const durationMs = endedAtMs - startedAtMs;
        emitDatabaseDiagnostic({
          taskId,
          operation: meta.name,
          feature: meta.feature,
          priority: meta.priority,
          kind,
          traceId: meta.traceId,
          transactionId,
          queuedAt,
          startedAt,
          rolledBackAt: kind === 'transaction' ? timestamp(endedAtMs) : undefined,
          completedAt: kind === 'transaction' ? undefined : timestamp(endedAtMs),
          queueWaitMs,
          durationMs,
          ...describeTiming(timing, durationMs),
          outcome: kind === 'transaction' ? 'rolled_back' : 'failed',
          error,
        });
        throw new CoordinatedDatabaseError(classifyDatabaseError(error), meta, error);
      }
    };

    if (kind === 'read') return this.scheduler.scheduleRead(meta, run);
    if (kind === 'barrier') return this.scheduler.scheduleBarrier(meta, run);
    return this.scheduler.scheduleWrite(meta, run);
  }
}

export const databaseCoordinator = new DatabaseCoordinator();
