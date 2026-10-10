/** 新增账单；手动录入可安排记账 AI 回复，AI 工具录入不再触发另一轮回复。 */
import type { WalletRecord } from '../domain/WalletRecord';
import type { CreateWalletRecordInput, ILedgerRepository } from '../domain/LedgerRepository';
import {
  queueLedgerAIReply,
  type LedgerAIReplyCallback,
} from './QueueLedgerAIReply';

export interface WalletAIReplyCallbacks {
  onLedgerAIReply?: LedgerAIReplyCallback;
  onError?: (error: Error) => void;
}

export interface AddWalletRecordResult {
  success: boolean;
  record: WalletRecord | null;
  queuedAIReply: boolean;
  error: string | null;
}

interface AddWalletRecordDeps {
  repository: ILedgerRepository;
  queueAIReply?: (
    params: Parameters<typeof queueLedgerAIReply>[0],
    callbacks: Parameters<typeof queueLedgerAIReply>[1]
  ) => ReturnType<typeof queueLedgerAIReply>;
}

export async function addWalletRecord(
  params: CreateWalletRecordInput,
  callbacks: WalletAIReplyCallbacks = {},
  deps: AddWalletRecordDeps
): Promise<AddWalletRecordResult> {
  const repo = deps.repository;

  try {
    const record = await repo.insertRecord(params);

    let queuedAIReply = false;
    try {
      if (deps.queueAIReply) {
        const queueResult = await deps.queueAIReply({ record }, callbacks);
        queuedAIReply = queueResult.queued;
      }
    } catch (queueError) {
      console.warn('[addWalletRecord] Failed to queue ledger AI reply:', queueError);
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
    console.error('[addWalletRecord] Failed:', error);
    return {
      success: false,
      record: null,
      queuedAIReply: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
