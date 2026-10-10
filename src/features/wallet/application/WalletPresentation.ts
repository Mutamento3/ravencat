import type { AIProfile, IAIAssistantRepository } from '@features/assistants';
import type { QuickAction, WalletRecord } from '../domain/WalletRecord';
import type { ILedgerRepository, UpdateWalletRecordInput } from '../domain/LedgerRepository';

export interface WalletPresentationDeps {
  assistantRepository: Pick<IAIAssistantRepository, 'getAll' | 'getLedgerAI'>;
  ledgerRepository: ILedgerRepository;
}

export interface WalletScreenData {
  records: WalletRecord[];
  quickActions: QuickAction[];
  monthlyStats: {
    expense: number;
    income: number;
  };
  aiList: AIProfile[];
  ledgerAI: AIProfile | null;
}

export async function getWalletScreenData(
  date: Date,
  deps: WalletPresentationDeps
): Promise<WalletScreenData> {
  const { assistantRepository, ledgerRepository } = deps;
  const [records, quickActions, stats, aiList, ledgerAI] = await Promise.all([
    ledgerRepository.getRecords({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      limit: 50,
    }),
    ledgerRepository.getQuickActions(),
    ledgerRepository.getMonthlyStats(date.getFullYear(), date.getMonth() + 1),
    assistantRepository.getAll(),
    assistantRepository.getLedgerAI(),
  ]);

  return {
    records,
    quickActions,
    monthlyStats: {
      expense: stats.totalExpense,
      income: stats.totalIncome,
    },
    aiList,
    ledgerAI,
  };
}

export async function deleteWalletRecord(recordId: string, deps: Pick<WalletPresentationDeps, 'ledgerRepository'>): Promise<boolean> {
  return deps.ledgerRepository.deleteRecord(recordId);
}

export async function updateWalletRecord(
  recordId: string,
  updates: UpdateWalletRecordInput,
  deps: Pick<WalletPresentationDeps, 'ledgerRepository'>
): Promise<boolean> {
  return deps.ledgerRepository.updateRecord(recordId, updates);
}

export async function addWalletQuickAction(action: Partial<QuickAction>, deps: WalletPresentationDeps) {
  return deps.ledgerRepository.insertQuickAction(action);
}

export async function deleteWalletQuickAction(id: string, deps: WalletPresentationDeps): Promise<boolean> {
  return deps.ledgerRepository.deleteQuickAction(id);
}

export async function getLedgerRangeSummary(startDate: string, endDate: string, deps: WalletPresentationDeps) {
  return deps.ledgerRepository.getRangeSummary(startDate, endDate);
}
