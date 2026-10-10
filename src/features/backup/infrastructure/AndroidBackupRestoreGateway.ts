import {
  activatePreparedRestoreAndExit,
  discardPreparedRestore,
  prepareRestore,
} from '../../../../modules/backup-storage';

import type { BackupRestoreGateway } from '../domain/BackupRestoreGateway';

export class AndroidBackupRestoreGateway implements BackupRestoreGateway {
  prepare(artifactLocator: string, currentDatabaseContractVersion: number) {
    return prepareRestore({ artifactLocator, currentDatabaseContractVersion });
  }

  discard(restoreId: string): Promise<void> {
    return discardPreparedRestore(restoreId);
  }

  activateAndExit(restoreId: string, rollbackStableSettingsJson: string): Promise<void> {
    return activatePreparedRestoreAndExit(restoreId, rollbackStableSettingsJson);
  }
}
