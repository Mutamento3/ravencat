import { prepareBackup } from '../../../../modules/backup-storage';

import type {
  BackupArchiveBuilder,
  PrepareBackupArchiveInput,
} from '../domain/BackupArchiveBuilder';

export class AndroidBackupArchiveBuilder implements BackupArchiveBuilder {
  prepare(input: PrepareBackupArchiveInput) {
    return prepareBackup(input);
  }
}
