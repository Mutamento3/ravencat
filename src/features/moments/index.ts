/** 朋友圈功能公共出口，包含界面门面、应用层命令、仓储与 AI 工具。 */
export { MomentsTab, MomentsSettingsView, PublishView } from './presentation';
export { DEFAULT_MOMENTS_COVER_SOURCE } from './presentation/useMomentsCover';
export type { PublishMomentDraft } from './presentation';
export {
  createUserMomentComment,
  createUserMomentLike,
  createUserMomentRecord,
  getCurrentMomentUserProfile,
  listMomentRecords,
  removeMomentCommentById,
  removeMomentRecord,
  removeUserMomentLike,
  retryMomentMediaAnalysis,
  saveMomentMediaAnalysis,
} from './presentationFacade';
export { AICommentMomentTool } from './aiTools/AICommentMomentTool';
export { AICreateMomentTool } from './aiTools/AICreateMomentTool';
export { AIDeleteOwnMomentCommentTool } from './aiTools/AIDeleteOwnMomentCommentTool';
export { AIDeleteOwnMomentTool } from './aiTools/AIDeleteOwnMomentTool';
export { AILikeMomentTool } from './aiTools/AILikeMomentTool';
export { AIReplyMomentCommentTool } from './aiTools/AIReplyMomentCommentTool';
export { AIUnlikeMomentTool } from './aiTools/AIUnlikeMomentTool';
export { GetMomentDetailTool } from './aiTools/GetMomentDetailTool';
export { ReadSocialInboxTool } from './aiTools/ReadSocialInboxTool';
export { SearchMomentsTool } from './aiTools/SearchMomentsTool';
export {
  SQLiteMomentRepository,
  momentRepository,
} from './infrastructure/SQLiteMomentRepository';
// AI 侧读写的唯一信任边界：可见性断言与受保护写命令。
export {
  assertMomentVisibleToAgent,
  commentMomentAsUser,
  commentMomentAsAgent,
  createAgentMoment,
  createUserMoment,
  createUserMomentWithMedia,
  deleteMomentCommentAsUser,
  deleteOwnMomentAsAgent,
  deleteOwnMomentAsUser,
  deleteOwnMomentCommentAsAgent,
  likeMomentAsAgent,
  likeMomentAsUser,
  loadMomentActorDirectory,
  loadSocialInboxSummary,
  formatSocialInboxSummary,
  replyMomentCommentAsAgent,
  unlikeMomentAsAgent,
  unlikeMomentAsUser,
  editMomentMediaAnalysis,
  getMomentImageAnalysisModelSelection,
  getMomentSettings,
  listMomentImageAnalysisModelCandidates,
  reanalyzeMomentMedia,
  setMomentImageAnalysisModel,
  MAX_MOMENT_MEDIA_COUNT,
  subscribeMomentMediaAnalysisUpdated,
} from './application';
export type {
  MomentActorDirectory,
  MomentAgentActor,
  MomentAudienceDirectory,
  CreateUserMomentWithMediaInput,
  MomentMediaAnalysisAttemptResult,
  MomentMediaDraft,
  ResolvedMomentActor,
} from './application';
export type {
  MomentRecord,
  MomentRecordActor,
  MomentRecordComment,
  MomentRecordLike,
  MomentRecordMedia,
} from './presentationFacade';
export { MomentDomainError } from './domain/MomentErrors';
export type { MomentDomainErrorCode } from './domain/MomentErrors';
export type {
  IMomentRepository,
  CreateMomentMediaReferenceInput,
  InsertMomentCommentInput,
  InsertMomentLikeInput,
  Moment,
  MomentActorType,
  MomentAudience,
  MomentAudienceMode,
  MomentComment,
  MomentLike,
  MomentDetailSnapshot,
  MomentSocialDelivery,
  MomentSocialDeliveryEventType,
  MomentPageCursor,
  MomentPageRequest,
  MomentMedia,
  MomentMediaAnalysisSource,
  MomentMediaAnalysisStatus,
  MomentSettings,
} from './domain/MomentRepository';
export {
  MomentImageAnalysisError,
} from './domain/MomentImageAnalysis';
export type {
  MomentImageAnalysisErrorCode,
  MomentImageAnalysisModelRef,
  MomentImageAnalysisModelSelection,
  MomentImageAnalysisModelSelectionStatus,
} from './domain/MomentImageAnalysis';
