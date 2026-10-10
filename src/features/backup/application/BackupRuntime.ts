import type { BackupArtifactHandle, BackupArtifactSummary } from '../domain/BackupTarget';

export interface BackupRuntime {
  clearLegacyCachedImageSelections(): Promise<{ callBackground: boolean; wallpapers: number; momentsCover: boolean }>;
  createLocalBackup(): Promise<BackupArtifactSummary>;
  deleteLocalBackup(artifactId: string): Promise<void>;
  listLocalBackups(): Promise<BackupArtifactSummary[]>;
  restoreLocalBackup(artifactId: string): Promise<void>;
  restoreExternalBackup(artifact: BackupArtifactHandle): Promise<void>;
  pickExternalBackup(): Promise<BackupArtifactHandle | null>;
}
