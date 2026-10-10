/** 通话入口共用启动门：恢复事务完成后才开放当前数据库 generation。 */
import { initDatabase } from '@platform/persistence';
import { completePendingBackupRestore } from './completePendingBackupRestore';

export async function ensureCallHostReady(): Promise<void> {
  await completePendingBackupRestore();
  await initDatabase();
}
