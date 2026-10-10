import { createBackupSourceGateway } from './createBackupSourceGateway';
import { ensureCallBackgroundMigration } from '@features/calls/composition';
import { clearLegacyCachedCallBackground } from '@features/calls';
import { clearCurrentUserLegacyCachedMomentsCover, clearLegacyCachedWallpapers } from '@features/profile';
import { ensureCurrentUserMomentsCover, ensureWallpaperSelections } from '@features/profile/composition';
import Constants from 'expo-constants';
import { AppState } from 'react-native';
import { stopMemoryEmbeddingQueueForReset, setMemoryEmbeddingForegroundActive } from '../runtime/MemoryEmbeddingQueueCoordinator';
import { stopChatSummaryQueueForReset, setChatSummaryForegroundActive } from '../runtime/ChatSummaryQueueCoordinator';

import {
  AndroidBackupArchiveBuilder,
  AndroidBackupRestoreGateway,
  AndroidDownloadsBackupTarget,
  createLocalBackupUseCase,
  createRestoreBackupUseCase,
  createRestoreLocalBackupUseCase,
  pickExternalBackupArtifact,
} from '@features/backup/composition';
import type { BackupRuntime } from '@features/backup';
import { DATABASE_BACKUP_CONTRACT_VERSION } from '@platform/persistence';
import { withMediaFileLifetime } from '@platform/device';

export function createBackupRuntime(): BackupRuntime {
  const localDownloads = new AndroidDownloadsBackupTarget();
  const sourceGateway = createBackupSourceGateway();
  const createBackup = createLocalBackupUseCase({
    archiveBuilder: new AndroidBackupArchiveBuilder(),
    localTarget: localDownloads,
    sourceGateway,
    appVersion: Constants.expoConfig?.version ?? 'unknown',
    databaseContractVersion: DATABASE_BACKUP_CONTRACT_VERSION,
  });
  const createLocalBackupWithoutClaim = async () => {
    // 旧文件迁移可能需要释放准备副本，必须在备份的删除持有开始前完成。
    await ensureCallBackgroundMigration();
    await ensureWallpaperSelections();
    await ensureCurrentUserMomentsCover();
    return withMediaFileLifetime(() => createBackup());
  };
  const nativeRestore = new AndroidBackupRestoreGateway();
  const restoreDependencies = {
    restoreGateway: {
      prepare: nativeRestore.prepare.bind(nativeRestore),
      discard: nativeRestore.discard.bind(nativeRestore),
      async activateAndExit(restoreId: string, rollbackStableSettingsJson: string) {
        await stopMemoryEmbeddingQueueForReset();
        await stopChatSummaryQueueForReset();
        try { await nativeRestore.activateAndExit(restoreId, rollbackStableSettingsJson); }
        catch (error) {
          const active = AppState.currentState === 'active';
          setMemoryEmbeddingForegroundActive(active); setChatSummaryForegroundActive(active);
          throw error;
        }
      },
    },
    sourceGateway,
    localTarget: localDownloads,
    databaseContractVersion: DATABASE_BACKUP_CONTRACT_VERSION,
  };
  const restoreExternalBackupWithoutClaim = createRestoreBackupUseCase(restoreDependencies);
  const restoreLocalBackupWithoutClaim = createRestoreLocalBackupUseCase(
    restoreDependencies,
    restoreExternalBackupWithoutClaim,
  );
  let mutationRunning = false;
  const runMutation = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (mutationRunning) throw new Error('已有备份或恢复操作正在进行');
    mutationRunning = true;
    try {
      return await operation();
    } finally {
      mutationRunning = false;
    }
  };

  return {
    clearLegacyCachedImageSelections: () => runMutation(async () => ({
      callBackground: await clearLegacyCachedCallBackground(),
      wallpapers: await clearLegacyCachedWallpapers(),
      momentsCover: await clearCurrentUserLegacyCachedMomentsCover(),
    })),
    createLocalBackup: () => runMutation(createLocalBackupWithoutClaim),
    deleteLocalBackup: (artifactId) => runMutation(() => localDownloads.delete(artifactId)),
    listLocalBackups: () => localDownloads.list(),
    restoreLocalBackup: (artifactId) => runMutation(
      () => restoreLocalBackupWithoutClaim(artifactId),
    ),
    restoreExternalBackup: (artifact) => runMutation(
      () => restoreExternalBackupWithoutClaim(artifact),
    ),
    pickExternalBackup: pickExternalBackupArtifact,
  };
}
