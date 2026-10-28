import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type { CallDirection } from './CallSession';

export interface CallRingtoneSelection {
  mediaAssetId: string | null;
  fileName: string | null;
  revision: number;
}

export interface CallRingtoneRepository {
  get(assistantId: string, direction: CallDirection): Promise<CallRingtoneSelection | null>;
  commit(transaction: DatabaseTransactionExecutor, assistantId: string, direction: CallDirection,
    expectedRevision: number | null, mediaAssetId: string | null, fileName: string | null): Promise<void>;
}
