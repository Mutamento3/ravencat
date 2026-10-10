/**
 * @fileoverview HistoryDetailScreen 类型定义
 */

import type { WalletRecord, CategoryStat } from '../../domain/WalletRecord';

export interface TimeRange {
  startDate: string;
  endDate: string;
  label: string;
}

export interface SummaryData {
  timeRange: TimeRange;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categoryStats: CategoryStat[];
  records: WalletRecord[];
}

export interface HistoryDetailScreenProps {
  onBack: () => void;
  timeRange: TimeRange;
  initialData?: SummaryData;
}

export interface CategoryGroupData {
  category: string;
  type: 'income' | 'expense';
  total: number;
  percentage: number;
  count: number;
  color: string;
  records: WalletRecord[];
}
