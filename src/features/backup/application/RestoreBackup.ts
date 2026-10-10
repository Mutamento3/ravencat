import type { BackupRestoreGateway } from '../domain/BackupRestoreGateway';
import type { BackupArtifactHandle, BackupTarget } from '../domain/BackupTarget';
import type { BackupSourceGateway } from './CreateLocalBackup';

interface RestoreBackupDependencies {
  restoreGateway: BackupRestoreGateway;
  sourceGateway: BackupSourceGateway;
  localTarget: BackupTarget;
  databaseContractVersion: number;
}

export function createRestoreBackupUseCase(dependencies: RestoreBackupDependencies) {
  return async (artifact: BackupArtifactHandle): Promise<void> => {
    const prepared = await dependencies.restoreGateway.prepare(
      artifact.locator,
      dependencies.databaseContractVersion,
    );
    let rollbackStableSettingsJson: string;
    try {
      // 登记恢复事务前完成全部 owner preflight：
      // bubble skin、壁纸与通话背景的 incoming 媒体引用都必须能在 staging 中真实命中。
      await dependencies.sourceGateway.validateStableSettingsJson(
        prepared.stableSettingsJson,
        prepared.bubbleSkinRootUri,
        prepared.mediaRootUri,
        prepared.databaseUri,
      );
      rollbackStableSettingsJson = await dependencies.sourceGateway.exportStableSettingsJson();
    } catch (error) {
      await dependencies.restoreGateway.discard(prepared.restoreId);
      throw error;
    }
    await dependencies.restoreGateway.activateAndExit(
      prepared.restoreId,
      rollbackStableSettingsJson,
    );
  };
}

export function createRestoreLocalBackupUseCase(
  dependencies: RestoreBackupDependencies,
  restoreArtifact: (artifact: BackupArtifactHandle) => Promise<void>,
) {
  return async (artifactId: string): Promise<void> => {
    await restoreArtifact(await dependencies.localTarget.open(artifactId));
  };
}
