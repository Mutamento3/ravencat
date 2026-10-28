/** Wallet 功能公共出口，外部调用方只能从这里访问。 */
export { default as WalletScreen } from './presentation/WalletScreen';
export { default as WalletHistoryScreen } from './presentation/HistoryScreen';
export { default as WalletHistoryDetailScreen } from './presentation/HistoryDetailScreen';
export type { ViewType } from './presentation/HistoryScreen/types';
export {
  decodeWalletHistoryRangeId,
  encodeWalletHistoryRangeId,
} from './presentation/historyRoute';
export { GetLedgerContextTool } from './aiTools/GetLedgerContextTool';
export { SearchLedgerTool } from './aiTools/SearchLedgerTool';
export { AddLedgerRecordTool, UpdateLedgerRecordTool, DeleteLedgerRecordTool } from './aiTools/LedgerRecordTools';
export { SQLiteLedgerRepository, ledgerRepository } from './infrastructure/SQLiteLedgerRepository';
export {
  addWalletRecord,
  configureWalletRuntime,
  deleteWalletRecord,
  updateWalletRecord,
  getLedgerRangeSummary,
  getWalletScreenData,
  queueLedgerAIReply,
  triggerLedgerAIReply,
  applyQuickActionAndReply,
} from './composition';
export type { WalletRecord } from './domain/WalletRecord';
export type { WalletChatReplyGateway } from './application/TriggerLedgerAIReply';
