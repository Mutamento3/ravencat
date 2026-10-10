/**
 * @fileoverview 数据库辅助工具
 *
 * 通用数据库工具函数（clearDB, closeDB, getDBInfo, cleanupLegacyDatabases）
 *
 * @module infrastructure/storage/helpers
 */

import * as FileSystem from 'expo-file-system/legacy';
import { closeDB as closeDBConnection, getActiveDbName } from './sqlite/connection';
import { databaseCoordinator } from './runtime';
import { invalidateDatabaseInitialization } from './sqlite/initialization';

/**
 * 转义 SQLite 标识符，防止来自 sqlite_master 的表名被注入。
 * 表名虽由系统表产生，仍统一转义，避免未来含特殊字符的表名破坏 SQL。
 */
function quoteSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/** sqlite_master 中需要排除的 SQLite/平台保留表，不得包含任何 RavenCat 业务表。 */
const RESERVED_TABLES = new Set<string>(['android_metadata']);

interface MasterTableRow {
  name: string;
}

interface CountRow {
  count: number;
}

interface PragmaForeignKeysRow {
  foreign_keys: number;
}

interface PragmaForeignKeyCheckRow {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

/** 数据库信息 */
interface DBInfo {
  dbName: string;
  aiAssistants: number;
  sessions: number;
  messages: number;
  protocols: number;
  moments: number;
  momentComments: number;
  momentLikes: number;
  momentAudienceAi: number;
  momentSocialInboxDeliveries: number;
  memoryPools: number;
  ledgerRecords: number;
  ledgerQuickActions: number;
}

/**
 * 历史版本数据库主文件名。
 *
 * 这些都只作为 legacy garbage 清理，任何一个都不再是当前版本的可运行数据库候选：
 * `kimiphone_v4.db` 已随 v4 fallback 移除一并废弃，仅保留在清理名单中，避免老安装残留文件永久占据存储。
 */
const LEGACY_DB_FILES: string[] = [
  'kimiphone.db',
  'kimiphone_v1.db',
  'kimiphone_v2.db',
  'kimiphone_v3.db',
  'kimiphone_v4.db',
];

/**
 * SQLite 边车文件后缀；legacy 清理必须覆盖它们，否则残留页会继续占据存储。
 *
 * `-wal` / `-shm` 是 WAL 模式产物，`-journal` 是 rollback journal 模式产物。
 * 只用于 legacy 文件，绝不应用于活跃的 v5。
 */
const SQLITE_SIDECAR_SUFFIXES: string[] = ['', '-wal', '-shm', '-journal'];

/**
 * 清空用户产生的应用数据。
 *
 * 恢复出厂时清空全部应用表。表名从 sqlite_master 动态发现，不再维护手写名单，
 * 未来新增的业务表也会被自动清空。整个过程在单个独占写作用域中完成：
 * 关闭外键 → 开启手动事务 → 清空全部应用表 → 清空 sqlite_sequence → 提交 →
 * 恢复外键 → 校验外键完整性 → 校验所有应用表行数为 0。
 *
 * 失败路径必须回滚、恢复外键并抛出错误，不得 console.warn 后返回成功。
 * 不得删除数据库文件，也不得重新打开第二个数据库连接。
 */
export async function clearDB(): Promise<boolean> {
  const database = databaseCoordinator.openTaskExecutor({
    name: 'persistence.clear-user-data',
    feature: 'persistence',
    priority: 'interactive',
  });

  return database.withExclusiveWriteScopeAsync(async (db) => {
    // 1. 动态读取全部应用表名（排除 SQLite 内部表与平台保留表）。
    const tableRows = await db.getAllAsync<MasterTableRow>(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT IN ('android_metadata')
       ORDER BY name`
    );
    const applicationTables = tableRows
      .map((row) => row.name)
      .filter((name): name is string => Boolean(name) && !RESERVED_TABLES.has(name));

    if (applicationTables.length === 0) {
      // 没有应用表时仍要确保外键处于开启状态。
      await db.execAsync(`PRAGMA foreign_keys = ON;`);
      const fkRow = await db.getFirstAsync<PragmaForeignKeysRow>(`PRAGMA foreign_keys;`);
      if (!fkRow || fkRow.foreign_keys !== 1) {
        throw new Error('clearDB: foreign_keys 恢复失败，期望 1');
      }
      return true;
    }

    // 2. 关闭外键（必须在事务开始前）。
    await db.execAsync(`PRAGMA foreign_keys = OFF;`);
    const fkOffRow = await db.getFirstAsync<PragmaForeignKeysRow>(`PRAGMA foreign_keys;`);
    if (!fkOffRow || fkOffRow.foreign_keys !== 0) {
      // 尝试恢复外键后，读取 PRAGMA 确认确实恢复为 1。
      try {
        await restoreForeignKeysAndVerify(db);
      } catch (restoreError) {
        throw new AggregateError(
          [
            new Error('clearDB: foreign_keys 关闭失败，期望 0'),
            restoreError instanceof Error ? restoreError : new Error(String(restoreError)),
          ],
          'clearDB: foreign_keys 关闭失败，且恢复外键也失败',
        );
      }
      throw new Error('clearDB: foreign_keys 关闭失败，期望 0');
    }

    // 3. 开启手动事务，清空全部应用表与 sqlite_sequence，提交。
    try {
      await db.execAsync(`BEGIN IMMEDIATE;`);
      try {
        for (const tableName of applicationTables) {
          const quoted = quoteSqlIdentifier(tableName);
          await db.execAsync(`DELETE FROM ${quoted};`);
        }
        // sqlite_sequence 记录 AUTOINCREMENT 序列，清空后自增列从 1 重新开始。
        await db.execAsync(`DELETE FROM sqlite_sequence;`);
        await db.execAsync(`COMMIT;`);
        // 清库保留连接和 schema，但已删除初始化创建的固定配置行。
        // 只在提交后失效缓存，下一轮启动门用同一 bootstrap 重建它们。
        invalidateDatabaseInitialization();
      } catch (innerError) {
        // 事务内失败：尝试回滚，再恢复外键，保留原始错误为 cause。
        let rollbackError: unknown = null;

        try {
          await db.execAsync(`ROLLBACK;`);
        } catch (error) {
          rollbackError = error;
        }

        if (rollbackError) {
          throw new AggregateError(
            [
              innerError instanceof Error
                ? innerError
                : new Error(String(innerError)),
              rollbackError instanceof Error
                ? rollbackError
                : new Error(String(rollbackError)),
            ],
            'clearDB: 清空事务失败，且 ROLLBACK 失败',
          );
        }

        throw innerError;
      }
    } catch (error) {
      // 无论事务是否已回滚，都要恢复外键并确认值为 1。
      // 恢复成功时以原始错误为 cause 抛出；恢复失败时用 AggregateError 同时保留两者。
      try {
        await restoreForeignKeysAndVerify(db);
      } catch (restoreError) {
        throw new AggregateError(
          [
            error instanceof Error ? error : new Error(String(error)),
            restoreError instanceof Error ? restoreError : new Error(String(restoreError)),
          ],
          'clearDB: 清空应用表失败，且恢复外键也失败',
        );
      }
      const wrapped = new Error('clearDB: 清空应用表失败', { cause: error });
      throw wrapped;
    }

    // 4. 恢复外键并确认值为 1。
    await restoreForeignKeysAndVerify(db);

    // 5. 执行 PRAGMA foreign_key_check，任何违规都必须失败。
    const fkViolations = await db.getAllAsync<PragmaForeignKeyCheckRow>(
      `PRAGMA foreign_key_check;`
    );
    if (fkViolations.length > 0) {
      const detail = fkViolations
        .map((row) => `table=${row.table} rowid=${row.rowid} parent=${row.parent} fkid=${row.fkid}`)
        .join('; ');
      throw new Error(`clearDB: foreign_key_check 发现外键违规：${detail}`);
    }

    // 6. 验证所有动态发现的应用表行数均为 0。
    for (const tableName of applicationTables) {
      const quoted = quoteSqlIdentifier(tableName);
      const row = await db.getFirstAsync<CountRow>(`SELECT COUNT(*) AS count FROM ${quoted};`);
      const rowCount = row?.count ?? 0;
      if (rowCount !== 0) {
        throw new Error(`clearDB: 表 ${tableName} 清空后仍有 ${rowCount} 行`);
      }
    }

    return true;
  });
}

/** 恢复外键并读取 PRAGMA 确认值为 1，失败则抛出。 */
async function restoreForeignKeysAndVerify(db: {
  execAsync: (source: string) => Promise<void>;
  getFirstAsync: <T>(source: string) => Promise<T | null>;
}): Promise<void> {
  await db.execAsync(`PRAGMA foreign_keys = ON;`);
  const fkOnRow = await db.getFirstAsync<PragmaForeignKeysRow>(`PRAGMA foreign_keys;`);
  if (!fkOnRow || fkOnRow.foreign_keys !== 1) {
    throw new Error('clearDB: foreign_keys 恢复失败，期望 1');
  }
}

/**
 * 关闭数据库连接
 */
export async function closeDB(): Promise<void> {
  await closeDBConnection();
}

/**
 * 删除历史版本数据库文件及其 `-wal` / `-shm` 边车文件。
 *
 * 当前 canonical 数据库（`kimiphone_v5.db`）不属于 legacy，绝不在这里删除：
 * 恢复出厂通过 clearDB 原地清空它的业务表，而不是删除正在被连接持有的文件。
 *
 * 不复用 expo-sqlite 的数据库删除 API：它只删除主文件，不清理 `-wal` / `-shm`，
 * 且目标文件不存在时会抛错，既不能覆盖边车文件也不幂等。这里按 canonical SQLite
 * 目录直接删除普通文件，并用幂等删除保证重复调用安全。
 *
 * 任一步失败都必须抛出，由恢复出厂流程统一上报，不得静默返回成功。
 */
export async function cleanupLegacyDatabases(): Promise<void> {
  const directory = sqliteDirectoryUri();

  await Promise.all(
    LEGACY_DB_FILES.flatMap((name) => SQLITE_SIDECAR_SUFFIXES.map((suffix) =>
      FileSystem.deleteAsync(`${directory}${name}${suffix}`, { idempotent: true }),
    )),
  );
}

/** expo-sqlite 在 Android 上的 canonical 数据库目录：`<filesDir>/SQLite/`。 */
function sqliteDirectoryUri(): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('FileSystem.documentDirectory 不可用，无法定位 SQLite 目录');
  }

  return `${FileSystem.documentDirectory}SQLite/`;
}

/**
 * 返回当前活动数据库名和核心表的行数统计（用于调试）
 */
export async function getDBInfo(): Promise<DBInfo | null> {
  try {
    const database = databaseCoordinator.openTaskExecutor({
      name: 'persistence.database-info',
      feature: 'persistence',
      priority: 'maintenance',
    });

    type CountRow = { c: number } | { COUNT: number } | Record<string, number>;

    const aiRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM ai_assistants`);
    const sessionsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM sessions`);
    const messagesRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM messages`);
    const protocolsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM protocols`);
    const momentsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM moments`);
    const momentCommentsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM moment_comments`);
    const momentLikesRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM moment_likes`);
    const momentAudienceAiRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM moment_audience_ai`);
    const momentSocialInboxRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM moment_social_inbox_deliveries`);
    const memoryPoolsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM memory_pools`);
    const ledgerRecordsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM ledger_records`);
    const ledgerQuickActionsRow = await database.getFirstAsync<CountRow>(`SELECT COUNT(*) as c FROM ledger_quick_actions`);

    const getCount = (row: CountRow | null): number => {
      if (!row) return 0;
      return (row as { c?: number }).c ?? (row as { COUNT?: number }).COUNT ?? 0;
    };

    return {
      dbName: getActiveDbName(),
      aiAssistants: getCount(aiRow),
      sessions: getCount(sessionsRow),
      messages: getCount(messagesRow),
      protocols: getCount(protocolsRow),
      moments: getCount(momentsRow),
      momentComments: getCount(momentCommentsRow),
      momentLikes: getCount(momentLikesRow),
      momentAudienceAi: getCount(momentAudienceAiRow),
      momentSocialInboxDeliveries: getCount(momentSocialInboxRow),
      memoryPools: getCount(memoryPoolsRow),
      ledgerRecords: getCount(ledgerRecordsRow),
      ledgerQuickActions: getCount(ledgerQuickActionsRow),
    };
  } catch (error) {
    console.warn('Failed to get DB info:', error);
    return null;
  }
}
