/** 初始化 SQLite：依次建表、迁移并创建索引。 */

import { databaseCoordinator } from '../runtime';
import { closeDBForRestoreRollback } from './connection';
import { SCHEMAS, INDEXES } from './schema';
import { runMigrations } from './migrations';

// 同一 JS runtime 共用一次初始化结果；失败时清空，下次调用才允许重试。
let initPromise: Promise<void> | null = null;

/** 清库提交后，旧初始化结果不再代表当前数据；重挂启动门必须重新建立默认记录。 */
export function invalidateDatabaseInitialization(): void {
  initPromise = null;
}

/**
 * 初始化数据库核心（建表、迁移、索引）
 * 注意：此方法不初始化业务数据（如朋友圈默认数据），业务数据初始化应在应用层进行
 */
export async function initDatabase(): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const db = databaseCoordinator.openTaskExecutor({
      name: 'sqlite.bootstrap',
      feature: 'persistence',
      priority: 'bootstrap',
    });
    // 整个 bootstrap（全部建表 + 迁移 + 全部索引）作为调度器中的一个独占写作用域执行，
    // 期间其他 read/write/transaction/barrier 不得插入；迁移 53/54 需要在事务外切换
    // PRAGMA foreign_keys，因此不能使用 withExclusiveTransactionAsync。
    // callback 拿到的是底层数据库执行器，其中的 SQL 不再逐条进入全局调度器。
    await db.withExclusiveWriteScopeAsync(async (database) => {
      for (const sql of Object.values(SCHEMAS)) {
        await database.execAsync(sql);
      }
      await runMigrations(database);
      for (const sql of Object.values(INDEXES)) {
        try {
          await database.execAsync(sql);
        } catch (e: unknown) {
          console.warn('Could not create index:', (e as Error).message);
        }
      }
    });
    console.log('🐦‍⬛ Database core initialized');
  })().catch((error) => {
    initPromise = null;
    throw error;
  });

  return initPromise;
}

/**
 * 初始化数据库（兼容旧版本，不再执行 V3→V4 迁移）
 * 供 App 启动时调用
 */
export async function initDatabaseWithMigration(): Promise<void> {
  await initDatabase();
  console.log('🐦‍⬛ Database initialized');
}

/**
 * 恢复启动门专用：bootstrap 已结束后关闭当前 generation，允许原生层安全换回旧数据库。
 * 该能力不暴露底层连接，也不能作为 Feature 的普通连接生命周期入口。
 */
export async function closeDatabaseForRestoreRollback(): Promise<void> {
  try {
    await closeDBForRestoreRollback();
  } finally {
    initPromise = null;
  }
}
