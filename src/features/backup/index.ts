/** 完整备份与恢复功能公共出口。 */
export { BackupScreen } from './presentation/BackupScreen';
export type { BackupRuntime } from './application/BackupRuntime';
export type { BackupArchiveBuilder, PrepareBackupArchiveInput } from './domain/BackupArchiveBuilder';
export type {
  BackupArtifactHandle,
  BackupArtifactSummary,
  BackupTarget,
  BackupTargetCapabilities,
} from './domain/BackupTarget';
