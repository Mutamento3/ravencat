/** 后台业务入口共用启动门：恢复事务完成后仍须初始化普通数据库 generation。 */
import { initDatabase } from '@platform/persistence';
import { completePendingBackupRestore } from './completePendingBackupRestore';

export async function ensureHostDatabaseReady(): Promise<void> {
  await completePendingBackupRestore();
  await initDatabase();
}
