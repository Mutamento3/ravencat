/** AI 助手与辅助模型功能公共出口。 */
export type { AIProfile, AIConfig } from './domain/AIProfile';
export { getAssistantDisplayName, getAssistantNicknamePromptContext } from './AssistantNickname';
export type * from './domain/AssistantToolPermission';
export * from './domain/AuxiliaryModel';
export type { ModelCallConfig } from './domain/ModelCallConfig';
export { default as CopyToGeneralModel } from './presentation/auxiliaryModels/CopyToGeneralModel';
export { default as GeneralModelPrefill } from './presentation/auxiliaryModels/GeneralModelPrefill';
export { ApplicationSettingsAccessError } from './domain/ApplicationSettingsAccess';
export type { AIAssistantSettingsUpdate, AIAssistantSummary, IAIAssistantRepository } from './domain/AssistantRepository';
export type { IAIHostRepository } from './domain/HostRepository';
export { ReleaseHostCooldownTool } from './aiTools/ReleaseHostCooldownTool';
export { HostRelationshipError } from './domain/HostRepository';
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
  appointHostAIAssistant,
  createAIAssistant,
  deleteAIAssistant,
  getAIAssistantById,
  getHostAIAssistant,
  getHostAICooldownStatus,
  configureAssistantRuntime,
  listAIAssistants,
  listAIAssistantSummaries,
  setLedgerAIAssistant,
  revokeHostAIAssistant,
  runAsCurrentHostAuthority,
  runHostAuthorityMutation,
  releaseHostAICooldown,
  updateAIModelSettings,
  updateAIAssistantSettings,
  updateAIAssistantAvatarFromDraft,
  changeAssistantAvatarFromMediaAsset,
  changeAssistantPublicName,
  assertApplicationSettingsAccessInTransaction,
  subscribeAIAssistantUpdated,
} from './AIAssistantManagement';
export { AgentRegistryService, agentRegistryService } from './AgentRegistryService';
export { fetchModelsWithConfig, runConnectionTestByConfig } from './application/AIModelService';
export type * from './application/modelTypes';
export { default as AddAIScreen } from './presentation/management';
export {
  FetchModelsButton,
  ModelSelectHint,
  SelectedModel,
  TestConnectionButton,
} from './presentation/management/FormFields';
export { default as ContextLimitsApply } from './presentation/management/ContextLimitsApply';
export { default as AIModelSettings } from './presentation/management/AIModelSettings';
export { createHostAIAppointmentDialog } from './presentation/HostAIAppointmentDialog';
export { default as ConversationList } from './presentation/management/ConversationList';
export type { ConversationListPinTarget } from './presentation/management/ConversationList';
export {
  buildConversationListItems,
} from './presentation/management/conversationListItems';
export { default as ModelSection } from './presentation/management/AIModelSettings/ModelSection';
export { createModelSettingsStyles } from './presentation/management/AIModelSettings/styles';
export { AuxiliaryModelNavigator } from './presentation/auxiliaryModels';
export type { AuxiliaryModelRoute } from './presentation/auxiliaryModels';
export { BlockAIAssistantTool } from './aiTools/BlockAIAssistantTool';
export { UnblockAIAssistantTool } from './aiTools/UnblockAIAssistantTool';
export { subscribeAuxiliaryModelsChanged } from './AuxiliaryModelsChanged';

export { selectAssistantVoiceModel } from './application/AssistantVoiceModels';
