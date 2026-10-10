import type { AIProfile } from '@features/assistants';
import type { WalletRecord } from '../domain/WalletRecord';
import {
  type TriggerLedgerAIReplyParams,
  type TriggerLedgerAIReplyResult,
  type LedgerAIReplyPayload,
} from './TriggerLedgerAIReply';

const LEDGER_AI_BATCH_WINDOW_MS = 5500;

export type LedgerAIReplyCallback = (payload: LedgerAIReplyPayload) => void | Promise<void>;

export interface QueueLedgerAIReplyParams {
  record: WalletRecord;
}

export interface QueueLedgerAIReplyCallbacks {
  onLedgerAIReply?: LedgerAIReplyCallback;
  onError?: (error: Error) => void;
}

export interface QueueLedgerAIReplyResult {
  queued: boolean;
  aiId?: string;
  batchSize: number;
  reason?: string;
}

interface PendingLedgerBatch {
  aiProfile: AIProfile;
  records: WalletRecord[];
  timer: ReturnType<typeof setTimeout> | null;
  listeners: Set<LedgerAIReplyCallback>;
}

export interface QueueLedgerAIReplyDeps {
  getLedgerAI: () => Promise<AIProfile | null>;
  triggerReply: (params: TriggerLedgerAIReplyParams) => Promise<TriggerLedgerAIReplyResult>;
}

const pendingBatches = new Map<string, PendingLedgerBatch>();

export async function queueLedgerAIReply(
  params: QueueLedgerAIReplyParams,
  callbacks: QueueLedgerAIReplyCallbacks = {},
  deps: QueueLedgerAIReplyDeps
): Promise<QueueLedgerAIReplyResult> {
  const ledgerAI = await deps.getLedgerAI();
  if (!ledgerAI) {
    return {
      queued: false,
      batchSize: 0,
      reason: '未设置记账 AI',
    };
  }

  if (!ledgerAI.apiKey || !ledgerAI.model) {
    return {
      queued: false,
      aiId: ledgerAI.id,
      batchSize: 0,
      reason: '记账 AI 缺少模型或 API Key 配置',
    };
  }

  const existingBatch = pendingBatches.get(ledgerAI.id);
  const batch: PendingLedgerBatch = existingBatch || {
    aiProfile: ledgerAI,
    records: [],
    timer: null,
    listeners: new Set<LedgerAIReplyCallback>(),
  };

  batch.aiProfile = ledgerAI;
  batch.records.push(params.record);

  if (callbacks.onLedgerAIReply) {
    batch.listeners.add(callbacks.onLedgerAIReply);
  }

  if (batch.timer) {
    clearTimeout(batch.timer);
  }

  batch.timer = setTimeout(() => {
    void flushLedgerAIReplyBatch(ledgerAI.id, callbacks, deps);
  }, LEDGER_AI_BATCH_WINDOW_MS);

  pendingBatches.set(ledgerAI.id, batch);

  return {
    queued: true,
    aiId: ledgerAI.id,
    batchSize: batch.records.length,
  };
}

async function flushLedgerAIReplyBatch(
  aiId: string,
  callbacks: QueueLedgerAIReplyCallbacks,
  deps: QueueLedgerAIReplyDeps
): Promise<void> {
  const batch = pendingBatches.get(aiId);
  if (!batch) {
    return;
  }

  pendingBatches.delete(aiId);
  if (batch.timer) {
    clearTimeout(batch.timer);
  }

  const uniqueRecords = dedupeRecords(batch.records);
  const listeners = Array.from(batch.listeners);

  const result = await deps.triggerReply({
    aiProfile: batch.aiProfile,
    newRecords: uniqueRecords,
  });

  if (!result.success || !result.payload) {
    if (result.error) {
      const error = new Error(result.error);
      callbacks.onError?.(error);
    }
    return;
  }

  for (const listener of listeners) {
    try {
      await listener(result.payload);
    } catch (listenerError) {
      console.warn('[queueLedgerAIReply] Listener failed:', listenerError);
    }
  }
}

function dedupeRecords(records: WalletRecord[]): WalletRecord[] {
  const seen = new Set<string>();
  const deduped: WalletRecord[] = [];

  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }

    seen.add(record.id);
    deduped.push(record);
  }

  return deduped;
}
