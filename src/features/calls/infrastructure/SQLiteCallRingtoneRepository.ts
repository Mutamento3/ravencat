import { databaseCoordinator, type DatabaseTransactionExecutor } from '@platform/persistence';
import { SettingChangeConflictError } from '@shared/errors/SettingChangeConflictError';
import type { CallDirection } from '../domain/CallSession';
import type { CallRingtoneRepository, CallRingtoneSelection } from '../domain/CallRingtoneRepository';

export class SQLiteCallRingtoneRepository implements CallRingtoneRepository {
  get(assistantId: string, direction: CallDirection): Promise<CallRingtoneSelection | null> {
    return databaseCoordinator.read({ name: 'calls.ringtone.get', feature: 'calls', priority: 'interactive' }, db =>
      db.getFirstAsync<CallRingtoneSelection>(`SELECT media_asset_id AS mediaAssetId, file_name AS fileName, revision
        FROM call_ringtone_selection WHERE assistant_id = ? AND direction = ?`, [assistantId, direction]));
  }

  async commit(tx: DatabaseTransactionExecutor, assistantId: string, direction: CallDirection,
    expectedRevision: number | null, mediaAssetId: string | null, fileName: string | null): Promise<void> {
    const result = expectedRevision === null
      ? await tx.runAsync(`INSERT OR IGNORE INTO call_ringtone_selection
          (assistant_id, direction, media_asset_id, file_name, revision) VALUES (?, ?, ?, ?, 0)`,
        [assistantId, direction, mediaAssetId, fileName])
      : await tx.runAsync(`UPDATE call_ringtone_selection SET media_asset_id = ?, file_name = ?, revision = revision + 1
          WHERE assistant_id = ? AND direction = ? AND revision = ?`,
        [mediaAssetId, fileName, assistantId, direction, expectedRevision]);
    if (result.changes !== 1) throw new SettingChangeConflictError('通话铃声已被其他操作更改，本次选择未保存。');
  }
}

export const callRingtoneRepository = new SQLiteCallRingtoneRepository();
