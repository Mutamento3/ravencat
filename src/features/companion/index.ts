/** Companion 功能公共 API；只暴露当前跨 Feature 与路由入口所需能力。 */

export {
  clearCompanionNativeDataForFactoryReset,
  getNativeHealth,
} from './application/CompanionNativeFacade';
export { getCompanionNotificationDiagnostics } from './application/CompanionNotificationFacade';
export { runCompanionWakeHeadlessTask } from './application/CompanionWakeHeadlessTask';
export { cancelCompanionWakeExecution } from './application/CompanionWakeHeadlessTask';
export {
  addCompanionExecutionCancelListener,
  addCompanionWakeListener,
} from './application/CompanionNativeFacade';
export {
  drainAndCancelAIScheduleProjectionRepair,
  invalidateAISchedulesForRevokedOwner,
  reconcileAIScheduleProjections,
} from './application/AIScheduleProjectionOwner';
export { recoverAIScheduleClaims } from './application/AIScheduleRecovery';
export {
  reconcileProactiveNativeRuntimeState,
  recordProactiveAgentRunState,
} from './application/ProactiveAgentRunState';
export { disableCompanionProductState } from './application/CompanionSettingsFacade';
export {
  loadProactiveLifeOverview,
  listProactiveLifeFuture,
  listProactiveLifeHistory,
} from './application/ProactiveLifeReadQueries';
export type {
  ProactiveLifeFutureCursor,
  ProactiveLifeFutureItem,
  ProactiveLifeHistoryCursor,
  ProactiveLifeHistoryItem,
  ProactiveLifeHistoryQuery,
  ProactiveLifeOverview,
  ProactiveLifeOverviewQuery,
  ProactiveLifeFutureQuery,
  ProactiveLifeRunningItem,
  ProactiveLifeSourceType,
} from './application/ProactiveLifeReadQueries';
export { COMPANION_PROMPT_DEFINITIONS } from './application/CompanionPromptDefinitions';
export {
  CancelAIScheduleTool,
  CreateAIScheduleTool,
  GetAIScheduleTool,
  ListAISchedulesTool,
  UpdateAIScheduleTool,
} from './aiTools/AIScheduleTools';

export { default as CompanionSettingsScreen } from './presentation/CompanionSettingsScreen';
export { default as CompanionSystemAccessScreen } from './presentation/CompanionSystemAccessScreen';
export { default as CompanionBlacklistScreen } from './presentation/CompanionBlacklistScreen';
export { default as ProactiveLifeScreen } from './presentation/ProactiveLifeScreen';
export { useCompanionFloatingBridge } from './presentation/useCompanionFloatingBridge';
