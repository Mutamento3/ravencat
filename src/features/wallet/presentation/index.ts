/** Internal presentation barrel for Wallet screens and view helpers. */

// 组件
export { default as WalletScreen } from './WalletScreen';
export { default as Overview } from './Overview';
export { default as QuickActions } from './QuickActions';
export { default as RecordList } from './RecordList';
export { default as AddRecordModal } from './AddRecordModal';
export { default as QuickActionModal } from './QuickActionModal';
export { default as SettingsModal } from './SettingsModal';
export { default as HistoryScreen } from './HistoryScreen';
export { default as HistoryDetailScreen } from './HistoryDetailScreen';

// 类型导出
export type {
  ViewType,
  TimeRange,
  DayInfo,
  WeekInfo,
  MonthInfo,
  SummaryData,
  HistoryScreenProps,
  CardData,
} from './HistoryScreen/types';

export type {
  HistoryDetailScreenProps,
  CategoryGroupData,
} from './HistoryDetailScreen/types';

// 工具函数
export {
  formatDate,
  getWeekdayLabel,
  getWeekDays,
  getMonthWeeks,
  getYearMonths,
  addDays,
  addMonths,
  addYears,
  getMonday,
  getSunday,
} from './utils/timeUtils';
