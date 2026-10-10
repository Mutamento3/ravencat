import * as SQLite from 'expo-sqlite';

export type SQLiteDatabase = Awaited<ReturnType<typeof SQLite.openDatabaseAsync>>;

/**
 * 唯一 canonical 业务数据库。
 *
 * 历史版本数据库不再承担任何迁移或运行职责：旧库只作为 legacy garbage 在恢复出厂路径删除
 * （见 helpers.cleanupLegacyDatabases）。数据库选择只有这一条路径，打开失败必须明确失败，
 * 不得自动切换到其他 database，也不得为旧的"严格打开"再引入第二套 open 流程。
 */
export const DB_NAME_DEFAULT = 'kimiphone_v5.db';

const OPEN_RETRY_COUNT = 3;
const OPEN_RETRY_DELAY_MS = 120;

let db: SQLiteDatabase | null = null;
let activeDbName: string | null = null;
let openingPromise: Promise<SQLiteDatabase> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeCloseDatabase(database: SQLiteDatabase | null): Promise<void> {
  if (!database) return;

  try {
    await database.closeAsync();
  } catch (error) {
    console.warn('[DB] Failed to close database instance:', error);
  }
}

async function configureDatabase(database: SQLiteDatabase, dbName: string): Promise<void> {
  await database.execAsync('PRAGMA foreign_keys = ON;');
  const foreignKeys = await database.getFirstAsync<{ foreign_keys: number }>(
    'PRAGMA foreign_keys;'
  );
  if (foreignKeys?.foreign_keys !== 1) {
    throw new Error(`Failed to enable foreign key constraints for ${dbName}`);
  }

  try {
    await database.execAsync('PRAGMA journal_mode = WAL;');
  } catch (error) {
    console.warn(`[DB] Failed to set WAL mode for ${dbName}:`, error);
  }

  try {
    await database.execAsync('PRAGMA synchronous = NORMAL;');
  } catch (error) {
    console.warn(`[DB] Failed to set synchronous mode for ${dbName}:`, error);
  }

  try {
    await database.execAsync('PRAGMA busy_timeout = 5000;');
  } catch (error) {
    console.warn(`[DB] Failed to set busy_timeout for ${dbName}:`, error);
  }
}

async function isConnectionValid(database: SQLiteDatabase): Promise<boolean> {
  try {
    await database.getFirstAsync('SELECT 1');
    return true;
  } catch (error) {
    console.warn('[DB] Connection validation failed:', error);
    return false;
  }
}

async function doOpenDB(): Promise<SQLiteDatabase> {
  console.log('[DB] Opening database...');

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= OPEN_RETRY_COUNT; attempt += 1) {
    let database: SQLiteDatabase | null = null;

    try {
      database = await SQLite.openDatabaseAsync(DB_NAME_DEFAULT);
      await configureDatabase(database, DB_NAME_DEFAULT);

      const isValid = await isConnectionValid(database);
      if (!isValid) {
        throw new Error(`Database connection test failed (attempt ${attempt})`);
      }

      db = database;
      activeDbName = DB_NAME_DEFAULT;
      console.log('[DB] Database opened successfully');
      return db;
    } catch (error) {
      lastError = error;
      await safeCloseDatabase(database);

      if (attempt < OPEN_RETRY_COUNT) {
        console.warn(
          `[DB] Failed to open ${DB_NAME_DEFAULT} on attempt ${attempt}, retrying...`,
          error
        );
        await delay(OPEN_RETRY_DELAY_MS * attempt);
      }
    }
  }

  console.error(`[DB] Failed to open ${DB_NAME_DEFAULT}:`, lastError);
  throw lastError instanceof Error ? lastError : new Error('无法打开 RavenCat 数据库');
}

async function openDBSerially(): Promise<SQLiteDatabase> {
  if (openingPromise) {
    return await openingPromise;
  }

  openingPromise = doOpenDB().finally(() => {
    openingPromise = null;
  });

  return await openingPromise;
}

export async function getDB(): Promise<SQLiteDatabase> {
  if (db) {
    return db;
  }

  return await openDBSerially();
}

export async function closeDB(): Promise<void> {
  if (db) {
    await safeCloseDatabase(db);
    db = null;
    activeDbName = null;
  }
}

/** restore rollback 必须确认连接已关闭，不能沿用普通清理路径的容错语义。 */
export async function closeDBForRestoreRollback(): Promise<void> {
  if (!db) return;
  const database = db;
  await database.closeAsync();
  db = null;
  activeDbName = null;
}

export function getActiveDbName(): string {
  return activeDbName || DB_NAME_DEFAULT;
}

export async function resetDB(): Promise<SQLiteDatabase> {
  await closeDB();
  return await getDB();
}
