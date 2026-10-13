/** AI 助手与辅助模型功能公共出口。 */
export type { AIProfile, AIConfig } from './domain/AIProfile';
export { getAssistantDisplayName, getAssistantNicknamePromptContext, acknowledgeAssistantNicknameNotice } from './AssistantNickname';
export type * from './domain/AssistantToolPermission';
export * from './domain/AuxiliaryModel';
export type { ModelCallConfig } from './domain/ModelCallConfig';
export { default as CopyToGeneralModel } from './presentation/auxiliaryModels/CopyToGeneralModel';
export { default as GeneralModelPrefill } from './presentation/auxiliaryModels/GeneralModelPrefill';
export { createChangeOwnAvatarTool } from './aiTools/ChangeOwnAvatarTool';
export type {
  AIAssistantSettingsUpdate,
  AIModelSettingsUpdate,
  AIAssistantSummary,
  IAIAssistantRepository,
} from './domain/AssistantRepository';
export type { IAIHostRepository, HostCooldownStatus, BlockAIParams, BlockedAIRecord } from './domain/HostRepository';
export {
  HostRelationshipError,
  type HostRelationshipErrorCode,
} from './domain/HostRepository';
export type { IAuxiliaryModelRepository } from './domain/AuxiliaryModelRepository';
export { AIAssistantRepository, aiAssistantRepository } from './infrastructure/SQLiteAssistantRepository';
export {
  assistantToolPermissionRepository,
  SQLiteAssistantToolPermissionRepository,
} from './infrastructure/SQLiteAssistantToolPermissionRepository';
export { AIHostRepository, aiHostRepository } from './infrastructure/SQLiteHostRepository';
export { AuxiliaryModelRepository, auxiliaryModelRepository } from './infrastructure/SQLiteAuxiliaryModelRepository';
export * from './ManageAuxiliaryModelConfigs';
export * from './ResolveAuxiliaryModel';
export * from './TestAuxiliaryModelConnection';
export {
  appointHostAIAssistant, createAIAssistant, deleteAIAssistant,
  getAIAssistantById,
  getHostAIAssistant, getHostAICooldownStatus,
  configureAssistantRuntime,
  getLedgerAIAssistant, listAIAssistants, listAIAssistantSummaries, setLedgerAIAssistant,
  revokeHostAIAssistant,
  runAsCurrentHostAuthority,
  runHostAuthorityMutation,
  clearHostAIAppointmentCooldownForDevelopment,
  updateAIModelSettings,
  updateAIAssistantSettings,
  applyAssistantContextLimits,
  updateAIAssistantAvatarFromDraft,
  subscribeAIAssistantUpdated,
} from './AIAssistantManagement';
export type {
  AIAssistantUpdatedListener,
  AssistantChatSessionGateway,
} from './AIAssistantManagement';
export type { CurrentHostAuthorityResult } from './application/HostAuthorityCoordinator';
export { AgentRegistryService, agentRegistryService } from './AgentRegistryService';
export type {
  AgentRegistryCollaborationState,
  AgentRegistryEntry,
  AgentRegistrySummary,
  GetAgentRegistrySummaryOptions,
} from './AgentRegistryService';
export {
  detectConnectionParamError, detectToolsSupportByConfig,
  fetchModelsWithConfig, getAIConnectionErrorInfo,
  normalizeModelConfigInput, runConnectionTestByConfig,
} from './application/AIModelService';
export type * from './application/modelTypes';
export { default as AddAIScreen } from './presentation/management';
export { default as ContextLimitsApply } from './presentation/management/ContextLimitsApply';
export type { AssistantContextLimits } from './domain/AssistantRepository';
export { default as AIModelSettings } from './presentation/management/AIModelSettings';
export { default as ConversationList } from './presentation/management/ConversationList';
export type { ConversationListPinTarget } from './presentation/management/ConversationList';
export {
  buildConversationListItems,
} from './presentation/management/conversationListItems';
export type {
  ConversationListItem,
  BuildConversationListItemsParams,
} from './presentation/management/conversationListItems';
export { default as ModelSection } from './presentation/management/AIModelSettings/ModelSection';
export { createModelSettingsStyles } from './presentation/management/AIModelSettings/styles';
export { AuxiliaryModelNavigator } from './presentation/auxiliaryModels';
export type { AuxiliaryModelRoute } from './presentation/auxiliaryModels';
export { BlockAIAssistantTool } from './aiTools/BlockAIAssistantTool';
export { UnblockAIAssistantTool } from './aiTools/UnblockAIAssistantTool';
export { subscribeAuxiliaryModelsChanged } from './AuxiliaryModelsChanged';

export { getAssistantVoiceModelSettings, selectAssistantVoiceModel, subscribeAssistantVoiceModelsChanged } from './application/AssistantVoiceModels';
