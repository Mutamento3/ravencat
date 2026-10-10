/**
 * @fileoverview SQLite 持久化平台公共出口
 *
 * 这里只公开跨业务的 SQLite 底座，包含：
 * - SQLite 基础连接和工具
 * - 数据库辅助函数
 * - Schema 和 Migration 工具
 *
 * @module platform/persistence
 */

// ============================================================================
// SQLite 基础
// ============================================================================

export * from './runtime';

// ============================================================================
// 数据库辅助工具
// ============================================================================

export { clearDB, cleanupLegacyDatabases, getDBInfo } from './helpers';
export {
  closeDatabaseForRestoreRollback,
  initDatabase,
  initDatabaseWithMigration,
} from './sqlite/initialization';
export {
  DATABASE_BACKUP_CONTRACT_VERSION,
  createDatabaseBackupSnapshot,
  deleteDatabaseBackupSnapshot,
} from './sqlite/backupSnapshot';

// 各业务仓储实现由对应 feature 公共出口提供，本入口只保留 SQLite 底座。
