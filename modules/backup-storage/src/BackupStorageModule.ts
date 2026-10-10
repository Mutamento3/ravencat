import { NativeModule, requireNativeModule } from 'expo-modules-core';

export interface PreparedBackupArtifact {
  artifactId: string;
  fileName: string;
  byteLength: number;
  locator: string;
}

export interface PublishedBackupArtifact extends PreparedBackupArtifact {
  createdAt: string;
}

export interface PreparedRestore {
  restoreId: string;
  createdAt: string;
  appVersion: string;
  stableSettingsJson: string;
  /** staging 中 bubble skin backing 的只读根。 */
  bubbleSkinRootUri: string;
  /** staging 中 persistent-media backing 的只读根。 */
  mediaRootUri: string;
  databaseUri: string;
}

export type PendingRestoreAction =
  | {
      kind: 'apply_settings';
      stableSettingsJson: string;
    }
  | {
      kind: 'restore_rollback_settings';
      stableSettingsJson: string;
      failureMessage: string;
    };

interface PrepareBackupOptions {
  databaseSnapshotUri: string;
  mediaRootUri: string;
  excludedMediaStoragePrefixes: readonly string[];
  bubbleSkinRootUri: string;
  stableSettingsJson: string;
  createdAt: string;
  appVersion: string;
  databaseContractVersion: number;
}

declare class BackupStorageNativeModule extends NativeModule {
  prepareBackup(
    options: PrepareBackupOptions,
  ): Promise<PreparedBackupArtifact>;
  publishToDownloads(
    sourceLocator: string,
    fileName: string,
  ): Promise<PublishedBackupArtifact>;
  listPublishedBackups(): Promise<PublishedBackupArtifact[]>;
  deletePublishedBackup(artifactId: string): Promise<void>;
  prepareRestore(options: {
    artifactLocator: string;
    currentDatabaseContractVersion: number;
  }): Promise<PreparedRestore>;
  discardPreparedRestore(restoreId: string): Promise<void>;
  activatePreparedRestoreAndExit(
    restoreId: string,
    rollbackStableSettingsJson: string,
  ): Promise<void>;
  readPendingRestoreAction(): Promise<PendingRestoreAction | null>;
  commitActivatedRestore(): Promise<void>;
  rollbackActivatedRestore(failureMessage: string): Promise<void>;
  completeRolledBackRestore(): Promise<void>;
  collectRestoreGarbage(): Promise<void>;
  consumeRestoreFailure(): Promise<string | null>;
}

const NativeBackupStorage =
  requireNativeModule<BackupStorageNativeModule>('BackupStorage');

export function prepareBackup(
  options: PrepareBackupOptions,
): Promise<PreparedBackupArtifact> {
  return NativeBackupStorage.prepareBackup(options);
}

export function publishBackupToDownloads(
  sourceLocator: string,
  fileName: string,
): Promise<PublishedBackupArtifact> {
  return NativeBackupStorage.publishToDownloads(sourceLocator, fileName);
}

export function listPublishedBackups(): Promise<PublishedBackupArtifact[]> {
  return NativeBackupStorage.listPublishedBackups();
}

export function deletePublishedBackup(artifactId: string): Promise<void> {
  return NativeBackupStorage.deletePublishedBackup(artifactId);
}

export function prepareRestore(options: {
  artifactLocator: string;
  currentDatabaseContractVersion: number;
}): Promise<PreparedRestore> {
  return NativeBackupStorage.prepareRestore(options);
}

export function discardPreparedRestore(restoreId: string): Promise<void> {
  return NativeBackupStorage.discardPreparedRestore(restoreId);
}

export function activatePreparedRestoreAndExit(
  restoreId: string,
  rollbackStableSettingsJson: string,
): Promise<void> {
  return NativeBackupStorage.activatePreparedRestoreAndExit(
    restoreId,
    rollbackStableSettingsJson,
  );
}

export function readPendingRestoreAction(): Promise<PendingRestoreAction | null> {
  return NativeBackupStorage.readPendingRestoreAction();
}

export function commitActivatedRestore(): Promise<void> {
  return NativeBackupStorage.commitActivatedRestore();
}

export function rollbackActivatedRestore(failureMessage: string): Promise<void> {
  return NativeBackupStorage.rollbackActivatedRestore(failureMessage);
}

export function completeRolledBackRestore(): Promise<void> {
  return NativeBackupStorage.completeRolledBackRestore();
}

export function collectRestoreGarbage(): Promise<void> {
  return NativeBackupStorage.collectRestoreGarbage();
}

export function consumeRestoreFailure(): Promise<string | null> {
  return NativeBackupStorage.consumeRestoreFailure();
}
