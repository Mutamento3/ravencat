/** Applies a saved quick action and schedules the optional ledger-assistant reply. */
import type { ILedgerRepository } from '../domain/LedgerRepository';
import {
  submitWalletRecord,
  type WalletAIReplyCallbacks,
  type WalletAIReplyQueue,
  type WalletRecordSubmissionResult,
} from './WalletRecordSubmission';

export type { WalletAIReplyCallbacks as WalletQuickActionCallbacks } from './WalletRecordSubmission';

export interface UseQuickActionParams {
  quickActionId: string;
  recordDate?: string;
}

interface UseQuickActionDeps {
  repository: ILedgerRepository;
  queueAIReply: WalletAIReplyQueue;
}

export async function applyQuickActionAndReply(
  params: UseQuickActionParams,
  callbacks: WalletAIReplyCallbacks = {},
  deps: UseQuickActionDeps
): Promise<WalletRecordSubmissionResult> {
  return submitWalletRecord(
    'applyQuickActionAndReply',
    () => deps.repository.useQuickAction(params.quickActionId, params.recordDate),
    callbacks,
    deps.queueAIReply
  );
}
