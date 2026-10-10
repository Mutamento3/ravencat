/** Applies a saved quick action and schedules the optional ledger-assistant reply. */
import type { WalletRecord } from '../domain/WalletRecord';
import type { ILedgerRepository } from '../domain/LedgerRepository';
import {
  queueLedgerAIReply,
  type LedgerAIReplyCallback,
} from './QueueLedgerAIReply';

export interface UseQuickActionParams {
  quickActionId: string;
  recordDate?: string;
}

export interface WalletQuickActionCallbacks {
  onLedgerAIReply?: LedgerAIReplyCallback;
  onError?: (error: Error) => void;
}

export interface UseQuickActionResult {
  success: boolean;
  record: WalletRecord | null;
  queuedAIReply: boolean;
  error: string | null;
}

interface UseQuickActionDeps {
  repository: ILedgerRepository;
  queueAIReply: (
    params: Parameters<typeof queueLedgerAIReply>[0],
    callbacks: Parameters<typeof queueLedgerAIReply>[1]
  ) => ReturnType<typeof queueLedgerAIReply>;
}

export async function applyQuickActionAndReply(
  params: UseQuickActionParams,
  callbacks: WalletQuickActionCallbacks = {},
  deps: UseQuickActionDeps
): Promise<UseQuickActionResult> {
  const repo = deps.repository;

  try {
    const record = await repo.useQuickAction(params.quickActionId, params.recordDate);

    let queuedAIReply = false;
    try {
      const queueResult = await deps.queueAIReply({ record }, callbacks);
      queuedAIReply = queueResult.queued;
    } catch (queueError) {
      console.warn('[applyQuickActionAndReply] Failed to queue ledger AI reply:', queueError);
      if (queueError instanceof Error) {
        callbacks.onError?.(queueError);
      }
    }

    return {
      success: true,
      record,
      queuedAIReply,
      error: null,
    };
  } catch (error) {
    console.error('[applyQuickActionAndReply] Failed:', error);
    return {
      success: false,
      record: null,
      queuedAIReply: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
