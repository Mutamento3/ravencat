/** Sticker Feature 的稳定公共出口。 */

export type {
  Sticker,
  StickerAnnotationMetadata,
  StickerGroup,
  StickerMessageSnapshot,
  StickerListMode,
} from './domain/Sticker';
export { STICKER_LIST_LIMIT, StickerLibraryFullError, StickerNotFoundError } from './domain/Sticker';
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
  releaseStickerAnnotation,
  renameStickerGroup,
  toggleStickerFavorite,
  claimStickerAnnotation,
} from './application/StickerCommands';
export {
  getStickerById,
  listStickerGroups,
  listStickers,
  listStickersInGroupForAI,
  resolveStickerMedia,
  searchStickers,
} from './application/StickerQueries';
export { STICKER_AI_SEARCH_DEFAULT_LIMIT, searchStickersForAI } from './application/StickerSearch';
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
  generateStickerEmbeddingBatch,
  getStickerEmbeddingIndexStatus,
  rebuildStickerEmbeddingIndex,
} from './application/StickerEmbeddings';
export {
  getStickerSystemModelSelection,
  resolveStickerEmbeddingModel,
  resolveStickerRecognitionModel,
  setStickerEmbeddingModel,
  setStickerRecognitionModel,
} from './application/StickerSystemModels';
export {
  isStickerSendIntent,
  ListStickerGroupsTool,
  ListStickersInGroupTool,
  SearchStickersTool,
  SelectStickerTool,
  listStickerGroupsDefinition,
  searchStickersDefinition,
} from './aiTools/StickerAgentTools';
export type { StickerEmbedding } from './domain/StickerEmbedding';
export {
  buildStickerSemanticText,
  cosineSimilarity,
  isStickerEmbeddingValid,
} from './domain/StickerEmbedding';
export type { StickerSystemConfig } from './domain/StickerSystemConfig';
export { StickerSystemScreen } from './presentation/stickerSystem';
export { AddOwnStickerTool, MaintainOwnStickerTool } from './aiTools/AIStickerLibraryTools';
