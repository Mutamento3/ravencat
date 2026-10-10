/**
 * @fileoverview HistoryScreen 类型定义
 */

import type { WalletRecord, CategoryStat } from '../../domain/WalletRecord';

export type ViewType = 'week' | 'month' | 'year';

export interface TimeRange {
  startDate: string;  // YYYY-MM-DD
  endDate: string;    // YYYY-MM-DD
  label: string;      // 显示文本
  year: number;
  month: number;
}

export interface DayInfo extends TimeRange {
  weekday: string;    // '今天', '昨天', '周一'...
  isToday: boolean;
}

export interface WeekInfo extends TimeRange {
  weekNum: number;    // 第几周
}

export interface MonthInfo extends TimeRange {
  monthName: string;  // '1月', '2月'...
  isYearSummary?: boolean;
}

export interface SummaryData {
  timeRange: TimeRange;
  totalExpense: number;
  totalIncome: number;
  balance: number;
  categoryStats: CategoryStat[];
  records: WalletRecord[];
}

export interface HistoryScreenProps {
  onBack: () => void;
  onSelectTimeRange: (timeRange: TimeRange, summary: SummaryData) => void;
  onViewChange?: (view: ViewType) => void; // 视图切换回调
  initialView?: ViewType;
  initialDate?: Date;
}

export type CardData = DayInfo | WeekInfo | MonthInfo;
