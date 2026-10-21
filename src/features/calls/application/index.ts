/** Calls 应用层公共出口，按生命周期、运行时、事件、快照与查询分组维护。 */

export {
  clearCallBackground,
  clearLegacyCachedCallBackground,
  loadCallBackgroundUri,
  setCustomCallBackground,
  getCallBackgroundImageSelection,
  changeCallBackgroundFromMediaAsset,
  subscribeCallBackgroundChanged,
} from './CallBackgroundSettings';

export {
  getIncomingCallDiagnostics,
  openFullScreenIntentSettings,
  openIncomingCallNotificationSettings,
} from './CallNotificationFacade';
export type { IncomingCallDiagnostics } from './CallNotificationFacade';

export {
  AICallRuntimeService,
  aiCallRuntimeService,
} from './runtime/AICallRuntimeService';
export type {
  AIOutgoingCallDecision,
  CallPreflightResult,
  CallPreflightOptions,
  IncomingCallRequest,
  MutateIncomingCallResult,
  RequestIncomingCallResult,
  StartOutgoingCallParams,
  StartOutgoingCallResult,
} from './runtime/AICallRuntimeService';
export {
  preflightCall,
  startOutgoingCall,
  endCall,
  requestIncomingCall,
  acceptCall,
  rejectCall,
  markIncomingCallMissed,
  getActiveCallSnapshot,
  subscribeActiveCall,
} from './lifecycle';
export { getActiveCall, getCallSession, listCallEvents } from './queries/GetCallSession';
export { shouldRestoreCallScreen } from './queries/CallScreenRestore';
export { appendAISpeechText, appendUserSpeechText } from './events/AppendCallTranscriptEvent';
export { appendCallErrorEvent } from './events/AppendCallSystemEvent';
export { appendCallCameraStateEvent, type CallCameraStateReason } from './events/AppendCallCameraStateEvent';
export { attachCallSnapshot, type AttachCallSnapshotInput, type AttachCallSnapshotResult } from './snapshots/AttachCallSnapshot';
export {
  registerCallSnapshotProvider,
  requestCallSnapshotFromProvider,
  type CallSnapshotProvider,
  type CallSnapshotProviderResult,
  type CallSnapshotRequestReason,
} from './snapshots/CallSnapshotProviderRegistry';
export {
  runCallTurn,
  submitCallUserInput,
  cancelCallTurn,
  type RunCallTurnParams,
  type RunCallTurnResult,
} from './runtime/RunCallTurn';
export type { CallTurnPhase } from './runtime/CallReplyRunState';
export {
  getCallReplyRunPhase,
  subscribeCallReplyRunPhase,
} from './runtime/CallReplyRunState';
export { callTTSPlaybackQueue, CallTTSPlaybackQueue } from './runtime/CallTTSPlaybackQueue';
export {
  subscribeCallSentencePlayback,
  type CallSentencePlaybackEvent,
} from './runtime/CallTTSPlaybackQueue';
export { saveCallStatusMessage } from './events/CreateCallStatusMessage';
export {
  reconcileInterruptedCallFromPreviousProcess,
} from './runtime/ReconcileInterruptedCall';
export {
  handleUserEndedCallFollowUp,
  isEligibleForPostUserHangUpFollowUp,
} from './runtime/PostUserHangUpFollowUp';
export {
  buildCallLivePromptBlocks,
  buildOutgoingCallDecisionBlocks,
  buildPostUserHangUpPromptBlocks,
  CALL_END_MARKER,
} from './CallPromptBlocks';
export type {
  SaveCallStatusMessageParams,
} from './events/CreateCallStatusMessage';
