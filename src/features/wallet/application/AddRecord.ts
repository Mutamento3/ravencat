/** 新增账单；手动录入可安排记账 AI 回复，AI 工具录入不再触发另一轮回复。 */
import type { CreateWalletRecordInput, ILedgerRepository } from '../domain/LedgerRepository';
import {
  submitWalletRecord,
  type WalletAIReplyCallbacks,
  type WalletAIReplyQueue,
  type WalletRecordSubmissionResult,
} from './WalletRecordSubmission';

export type { WalletAIReplyCallbacks } from './WalletRecordSubmission';

interface AddWalletRecordDeps {
  repository: ILedgerRepository;
  queueAIReply?: WalletAIReplyQueue;
}

export async function addWalletRecord(
  params: CreateWalletRecordInput,
  callbacks: WalletAIReplyCallbacks = {},
  deps: AddWalletRecordDeps
): Promise<WalletRecordSubmissionResult> {
  return submitWalletRecord(
    'addWalletRecord',
    () => deps.repository.insertRecord(params),
    callbacks,
    deps.queueAIReply
  );
}
