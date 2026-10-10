/** 完整备份与恢复路由适配。 */
import { useRouter } from 'expo-router';

import { BackupScreen } from '@features/backup';
import { createBackupRuntime } from '@host';

const backupRuntime = createBackupRuntime();

export default function BackupRoute() {
  const router = useRouter();
  return <BackupScreen onBack={() => router.back()} runtime={backupRuntime} />;
}
