/** Wallet 功能公共出口，外部调用方只能从这里访问。 */
export { WalletScreen } from './presentation';
export { default as WalletHistoryScreen } from './presentation/HistoryScreen';
export { default as WalletHistoryDetailScreen } from './presentation/HistoryDetailScreen';
export type { TimeRange, ViewType } from './presentation/HistoryScreen/types';
export {
  decodeWalletHistoryRangeId,
  encodeWalletHistoryRangeId,
} from './presentation/historyRoute';
export { GetLedgerContextTool } from './aiTools/GetLedgerContextTool';
export { SearchLedgerTool } from './aiTools/SearchLedgerTool';
export { AddLedgerRecordTool, UpdateLedgerRecordTool, DeleteLedgerRecordTool } from './aiTools/LedgerRecordTools';
export { SQLiteLedgerRepository, ledgerRepository } from './infrastructure/SQLiteLedgerRepository';
export {
  addWalletQuickAction,
  addWalletRecord,
  configureWalletRuntime,
  deleteWalletQuickAction,
  deleteWalletRecord,
  updateWalletRecord,
  getLedgerRangeSummary,
  getWalletScreenData,
  queueLedgerAIReply,
  triggerLedgerAIReply,
  applyQuickActionAndReply,
} from './composition';
export type {
  Category,
  CategoryStat,
  CategoryType,
  QuickAction,
  SummaryData,
  WalletRecord,
  WalletRecordType,
} from './domain/WalletRecord';
export type {
  CreateQuickActionInput,
  CreateWalletRecordInput,
  ILedgerRepository,
  LedgerKeywordSearchStats,
  LedgerRecordFilters,
  MonthlyLedgerStats,
  YearlyLedgerStats,
} from './domain/LedgerRepository';
export type {
  LedgerAIReplyPayload,
  WalletChatReplyGateway,
  WalletChatReplyRequest,
  WalletChatReplyResult,
} from './application/TriggerLedgerAIReply';
