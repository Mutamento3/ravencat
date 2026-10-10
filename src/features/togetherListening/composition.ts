/** 仅供 Host 组装 Together Listening 的具体仓储。 */

export {
  configureTogetherListeningRuntimeDependencies,
  type TogetherListeningNetEaseObservation,
  type TogetherListeningObservedPlaybackState,
  type TogetherListeningChatProjectionPort,
  type TogetherListeningSystemPresentationPort,
  type TogetherListeningDeclineFollowUpAIConfig,
  type TogetherListeningDeclineFollowUpMessageInput,
  type TogetherListeningDeclineFollowUpPort,
  type TogetherListeningRuntimeDependencies,
} from './application/TogetherListeningRuntime';
export type {
  TogetherListeningSystemPresentationState,
} from './application/TogetherListeningSystemPresentation';
export { togetherListeningRepository } from './infrastructure/SQLiteTogetherListeningRepository';
