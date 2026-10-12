/** Sticker Feature 的稳定公共出口。 */

export type {
  ListStickersInput,
  SearchStickersInput,
  Sticker,
  StickerAnnotationClaim,
  StickerAnnotationMetadata,
  StickerAnnotationStatus,
  StickerGroup,
  StickerMessageSnapshot,
  StickerListMode,
  StickerMetadataPatch,
} from './domain/Sticker';
export {
  STICKER_ANNOTATION_LEASE_MS,
  STICKER_ANNOTATION_LEASE_MS as STICKER_DEFAULT_ANNOTATION_LEASE_MS,
  STICKER_GROUP_LIMIT,
  STICKER_LIBRARY_MAX_COUNT,
  STICKER_LIST_LIMIT,
  STICKER_RECENT_LIMIT,
  StickerAnnotationClaimLostError,
  StickerGroupNotFoundError,
  StickerLibraryFullError,
  StickerNotFoundError,
} from './domain/Sticker';
export type {
  CreateStickerGroupInput,
  StickerRepository,
  StickerSemanticSearchInput,
} from './domain/StickerRepository';
export type {
  ClaimStickerAnnotationInput,
  CompleteStickerAnnotationInput,
  CreateStickerGroupCommandInput,
  FailStickerAnnotationInput,
  ImportStickerInput,
  ImportStickerResult,
  RecoverStickerAnnotationClaimsInput,
  ReleaseStickerAnnotationInput,
} from './application/StickerCommands';
export {
  createStickerGroup,
  completeStickerAnnotation,
  completeStickerAnnotationManually,
  deleteStickerFromLibrary,
  deleteStickerGroup,
  editStickerMetadata,
  failStickerAnnotation,
  importSticker,
  moveStickerToGroup,
  recordUserStickerUse,
  recoverInterruptedStickerAnnotations,
  recoverStickerAnnotationClaims,
  releaseStickerAnnotation,
  renameStickerGroup,
  retryStickerAnnotation,
  toggleStickerFavorite,
  claimStickerAnnotation,
} from './application/StickerCommands';
export type { ResolvedStickerMedia } from './application/StickerQueries';
export {
  getStickerById,
  listStickerGroups,
  listStickers,
  listStickerGroupsForAI,
  listStickersInGroupForAI,
  resolveStickerMedia,
  resolveStickerUri,
  searchStickers,
} from './application/StickerQueries';
export type { StickerGroupPage } from './application/StickerQueries';
export {
  STICKER_AI_SEARCH_DEFAULT_LIMIT,
  STICKER_AI_SEARCH_MAX_LIMIT,
  searchStickersForAI,
} from './application/StickerSearch';
export {
  emitStickerAnnotationPending,
  subscribeStickerAnnotationPending,
} from './application/StickerAnnotationPendingSignal';
export {
  subscribeStickerAnnotationChanged,
} from './application/StickerAnnotationChangedSignal';
export {
  emitStickerEmbeddingPending,
  subscribeStickerEmbeddingPending,
} from './application/StickerEmbeddingPendingSignal';
export {
  STICKER_EMBEDDING_BATCH_SIZE,
  backfillMissingStickerEmbeddings,
  generateStickerEmbeddingBatch,
  getStickerEmbeddingIndexStatus,
  rebuildStickerEmbeddingIndex,
} from './application/StickerEmbeddings';
export type { GenerateStickerEmbeddingBatchResult } from './application/StickerEmbeddings';
export {
  getStickerSystemConfig,
  getStickerSystemModelSelection,
  listStickerModelCandidates,
  resolveStickerEmbeddingModel,
  resolveStickerRecognitionModel,
  setStickerEmbeddingModel,
  setStickerRecognitionModel,
} from './application/StickerSystemModels';
export type { StickerSystemModelSelection } from './application/StickerSystemModels';
export {
  isStickerSendIntent,
  ListStickerGroupsTool,
  ListStickersInGroupTool,
  SearchStickersTool,
  SelectStickerTool,
  listStickerGroupsDefinition,
  listStickersInGroupDefinition,
  searchStickersDefinition,
  selectStickerDefinition,
  STICKER_SEARCH_RESULT_DISCRIMINATOR,
  STICKER_SEND_INTENT_DISCRIMINATOR,
} from './aiTools/StickerAgentTools';
export type {
  ListStickersInGroupArgs,
  SearchStickersArgs,
  SelectStickerArgs,
  StickerAIGroupItemSnapshot,
  StickerAIGroupSnapshot,
  StickerAISearchSnapshot,
  StickerGroupListResultData,
  StickerGroupPageResultData,
  StickerSearchResultData,
  StickerSendIntent,
} from './aiTools/StickerAgentTools';
export type {
  StickerEmbedding,
  StickerEmbeddingIndexStatus,
} from './domain/StickerEmbedding';
export {
  buildStickerSemanticText,
  cosineSimilarity,
  isStickerEmbeddingValid,
} from './domain/StickerEmbedding';
export type { StickerSystemConfig } from './domain/StickerSystemConfig';
export type {
  StickerModelSelection,
  StickerModelSelectionStatus,
} from './domain/StickerSystemConfig';
export { StickerSystemScreen } from './presentation/stickerSystem';
export { AddOwnStickerTool, MaintainOwnStickerTool } from './aiTools/AIStickerLibraryTools';
