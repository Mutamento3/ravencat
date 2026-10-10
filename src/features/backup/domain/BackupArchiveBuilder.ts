import type { BackupArtifactHandle } from './BackupTarget';

export interface PrepareBackupArchiveInput {
  databaseSnapshotUri: string;
  mediaRootUri: string;
  excludedMediaStoragePrefixes: readonly string[];
  bubbleSkinRootUri: string;
  stableSettingsJson: string;
  createdAt: string;
  appVersion: string;
  databaseContractVersion: number;
}

/** 将已收集的来源流式封装为完整备份产物。 */
export interface BackupArchiveBuilder {
  prepare(input: PrepareBackupArchiveInput): Promise<BackupArtifactHandle>;
}
