/** Wallet 领域拥有的仓储端口及查询、结果契约。 */
import type { QuickAction, WalletRecord, WalletRecordType } from './WalletRecord';

export interface LedgerRecordFilters {
  ids?: readonly string[];
  year?: number;
  month?: number;
  day?: number;
  type?: WalletRecordType;
  category?: string;
  keyword?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export type CreateWalletRecordInput = Partial<WalletRecord>;

export interface UpdateWalletRecordInput {
  type?: WalletRecordType;
  category?: string;
  detail?: string;
  amount?: number;
  recordDate?: string;
}

export interface CategoryStats {
  category: string;
  count: number;
  expense: number;
  income: number;
}

export interface DailyStats {
  date: string;
  count: number;
  expense: number;
  income: number;
}

export interface MonthlyLedgerStats {
  year: number;
  month: number;
  count: number;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categories: CategoryStats[];
  daily: DailyStats[];
}

export interface YearlyMonthlyStats {
  month: number;
  count: number;
  expense: number;
  income: number;
}

export interface YearlyLedgerStats {
  year: number;
  count: number;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  monthly: YearlyMonthlyStats[];
  categories: CategoryStats[];
}

export interface LedgerKeywordSearchStats {
  keyword: string;
  count: number;
  totalExpense: number;
  totalIncome: number;
  byDate: DailyStats[];
  byCategory: CategoryStats[];
}

export type CreateQuickActionInput = Partial<QuickAction>;

export interface UpdateQuickActionInput {
  name?: string;
  type?: WalletRecordType;
  category?: string;
  detail?: string;
  amount?: number;
  sortOrder?: number;
}

export interface ILedgerRepository {
  insertRecord(record: CreateWalletRecordInput): Promise<WalletRecord>;
  getRecords(filters?: LedgerRecordFilters): Promise<WalletRecord[]>;
  getMonthlyStats(year: number, month: number): Promise<MonthlyLedgerStats>;
  getYearlyStats(year: number): Promise<YearlyLedgerStats>;
  searchByKeyword(keyword: string, filters?: Omit<LedgerRecordFilters, 'day' | 'type' | 'category' | 'keyword' | 'limit'>): Promise<LedgerKeywordSearchStats>;
  deleteRecord(id: string): Promise<boolean>;
  updateRecord(id: string, updates: UpdateWalletRecordInput): Promise<boolean>;
  getQuickActions(): Promise<QuickAction[]>;
  insertQuickAction(action: CreateQuickActionInput): Promise<QuickAction>;
  updateQuickAction(id: string, updates: UpdateQuickActionInput): Promise<boolean>;
  deleteQuickAction(id: string): Promise<boolean>;
  useQuickAction(quickActionId: string, recordDate?: string): Promise<WalletRecord>;
  /** 返回预设与账单、快捷记账中已使用的分类；不受日期或记录条数限制。 */
  getCategories(type?: WalletRecordType): Promise<string[]>;
  
  /**
   * 获取时间范围内的汇总数据（用于历史记账详情页）
   * @param startDate 开始日期 YYYY-MM-DD
   * @param endDate 结束日期 YYYY-MM-DD
   * @returns 汇总数据
   */
  getRangeSummary(startDate: string, endDate: string): Promise<{
    totalExpense: number;
    totalIncome: number;
    balance: number;
    categoryStats: {
      category: string;
      type: 'income' | 'expense';
      amount: number;
      percentage: number;
      count: number;
      color: string;
    }[];
    records: WalletRecord[];
  }>;
}
