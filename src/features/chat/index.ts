/** 聊天功能的普通公共出口；Host 组装能力统一从 ./composition 获取。 */

// 普通会话与消息命令。
export {
  sendUserMessage,
} from './messages/application/SendUserMessage';
export type {
  AIAssistantConfig,
  SendUserMessageParams,
  SendUserMessageResult,
} from './messages/application/SendUserMessage';
export { receiveExternalAIMessage } from './messages/application/ReceiveExternalAIMessage';
export type {
  ReceiveExternalAIMessageParams,
  ReceiveExternalAIMessageResult,
} from './messages/application/ReceiveExternalAIMessage';
export {
  appendExternalAssistantMessage,
  appendExternalAssistantMessages,
} from './messages/application/AppendExternalAssistantMessages';
export type {
  AppendExternalAssistantMessageParams,
  AppendExternalAssistantMessageResult,
  AppendExternalAssistantMessagesParams,
  AppendExternalAssistantMessagesResult,
} from './messages/application/AppendExternalAssistantMessages';
export {
  upsertCallTimelineEntry,
} from './messages/application/UpsertCallTimelineEntry';
export type {
  UpsertCallTimelineEntryParams,
  UpsertCallTimelineEntryResult,
} from './messages/application/UpsertCallTimelineEntry';

// 回复配置与主动回复命令。
export type { AIReplyConfig } from './reply/application/ChatReplyTypes';
export {
  runChatVisibleAgent,
  listChatAgentActivityEvidence,
  interruptAbandonedChatAgentActivities,
} from './reply/application/RunChatVisibleAgent';
export type {
  ChatVisibleAgentModelGateway,
  RunChatVisibleAgentParams,
} from './reply/application/RunChatVisibleAgent';
export { buildChatUserMessageModelInput } from './reply/application/BuildChatBatchAIInput';
export {
  requestProactiveChatReply,
} from './reply/application/RequestProactiveChatReply';
export type {
  RequestProactiveChatReplyParams,
  RequestProactiveChatReplyResult,
  ProactiveChatReplySegment,
} from './reply/application/RequestProactiveChatReply';

// 会话与群聊公共命令/查询。
export {
  resolveCanonicalConversation,
} from './conversation/application/ResolveCanonicalConversation';
export type {
  ResolveCanonicalConversationParams,
} from './conversation/application/ResolveCanonicalConversation';
export {
  setDirectConversationPinned,
} from './conversation/application/ConversationPin';
export {
  getCanonicalChatConversation,
  clearChatConversationHistory,
  getChatDetailCurrentUser,
  getChatDetailAvailableAssistants,
} from './conversation/application/ChatPresentation';
export {
  listRecentChatTranscript,
  listRecentChatPreviewMessages,
  findCommittedAssistantMessageIdByRelatedSource,
  findFirstVisibleTimelineMessageByRunId,
  findFirstVisibleTimelineAnchorsByRunIds,
} from './messages/application/ChatReadQueries';
export type {
  ChatRecentTranscriptEntry,
  ChatPreviewMessage,
  ListRecentChatTranscriptParams,
  FindCommittedAssistantMessageIdByRelatedSourceParams,
  ChatTimelineAnchor,
  FindFirstVisibleTimelineMessageByRunIdParams,
  FindFirstVisibleTimelineAnchorsByRunIdsParams,
} from './messages/application/ChatReadQueries';
export { resolveCanonicalChatSourceMessages } from './messages/application/CanonicalChatSourceQueries';
export type {
  CanonicalChatSourceMessage,
  ResolveCanonicalChatSourceMessagesParams,
  ResolveCanonicalChatSourceMessagesOutcome,
} from './messages/application/CanonicalChatSourceQueries';
export {
  markChatMessagesReadByIds,
} from './messages/application/MarkChatMessagesReadByIds';
export type {
  MarkChatMessagesReadByIdsParams,
} from './messages/application/MarkChatMessagesReadByIds';
export {
  createGroupChat,
  deleteGroupChat,
  getGroupChat,
  listGroupChats,
  updateGroupChatAdminConfig,
  updateGroupChatPinned,
  updateGroupChatProfile,
  getActiveGroupSpeechPlan,
  getGroupParticipantDirectory,
  invokeGroupChat,
  markGroupConversationAsRead,
  sendGroupUserMessage,
} from './group/application';
export type { CreateGroupChatParams } from './group/application';

// 只读时间线查询。
export {
  messageTimeline,
  openConversationTimeline,
  loadOlderTimelineMessages,
  loadNewerTimelineMessages,
  subscribeConversationTimeline,
} from './messages/application/MessageTimeline';
export type {
  OpenConversationTimelineParams,
  LoadOlderTimelineParams,
  LoadNewerTimelineParams,
  TimelinePageResult,
  TimelineDeltaResult,
  TimelineMergeMode,
  CreateOptimisticUserTimelineMessageParams,
  MergeTimelineMessagesResult,
  SubscribeConversationTimelineParams,
} from './messages/application/MessageTimeline';
export { deleteChatMessage } from './messages/application/DeleteChatMessage';
export { markVoiceMessagePlayed } from './messages/application/MarkVoiceMessagePlayed';
export {
  voiceMessagePlaybackCoordinator,
  type VoiceMessagePlaybackViewState,
} from './messages/application/VoiceMessagePlaybackCoordinator';
export {
  startUserVoiceMessageRecording,
  type UserVoiceMessageRecording,
  type UserVoiceMessageResult,
} from './messages/application/UserVoiceMessageRecording';
export {
  SendVoiceMessageTool,
  createConfiguredVoiceMessageTool,
  isVoiceMessageSendIntent,
  type VoiceMessageSendIntent,
} from './reply/agent/SendVoiceMessageTool';

// 稳定领域 DTO。
export type {
  SenderType,
  MessageStatus,
  MessageDeliveryStatus,
  ChatMessage,
  MessagePaginationParams,
  PaginatedMessages,
  SendMessageParams,
} from './messages/domain/ChatMessage';
export type {
  ChatAttachmentType,
  ChatAttachmentSource,
  AttachmentDraftStatus,
  AttachmentParseStatus,
  ChatAttachment,
  LegacyChatAttachment,
  MediaAssetChatAttachment,
  ChatMessageAttachmentAIPolicy,
  ChatMessageHelperKind,
  ChatMessageHelperMetadata,
  ChatMessageAttachmentMetadata,
  AttachmentDraftItem,
} from './messages/domain/ChatAttachment';
export type {
  CallStatusMessageKind,
  CallStatusMessageMetadata,
  ChatCallDirection,
  ChatCallEndReason,
  ToolStatusMessageStatus,
  ToolStatusMessageMetadata,
  TogetherListeningMessageMetadata,
  TogetherListeningMessagePhase,
  TogetherListeningMessageEndReason,
  ParsedChatMessageMetadata,
  ChatVoiceMessageMetadata,
  ChatVoiceTranscriptSource,
} from './messages/domain/chatMessageMetadata';
export type { StickerMessageSnapshot, StickerMessageMetadata } from './messages/domain/ChatSticker';
export {
  parseMessageMetadata,
  getMessageAttachments,
  hasAttachments,
  getMessageDisplayKind,
  buildAttachmentMessageMetadata,
  getCallStatusMessageSender,
  buildCallStatusMessageMetadata,
  isCallStatusMessageMetadata,
  isToolStatusMessageMetadata,
  isTogetherListeningMessageMetadata,
  getTogetherListeningPreviewText,
  buildUserMessagePreviewText,
  buildAssistantMessagePreviewText,
  buildSessionPreviewTextFromMessage,
  buildChatVoiceMessageMetadata,
  isChatVoiceMessageMetadata,
  getMessageVoice,
  buildVoiceMessageModelText,
  buildChatSystemEventModelText,
  stringifyAttachmentSummary,
  formatFileSize,
} from './messages/domain/chatMessageMetadata';
export { buildStickerModelText } from './messages/domain/ChatSticker';
export { buildSharedChatRecordText } from './messages/domain/SharedChatRecord';
export { getMessageSharedRecord } from './messages/domain/chatMessageMetadata';
export { getMessageSticker, buildStickerMessagePreviewText } from './messages/domain/chatMessageMetadata';
export type {
  ChatSession,
} from './conversation/domain/SessionRepository';
export type {
  GroupSpeechPlanStatus,
  GroupSpeechTaskStatus,
  GroupSpeechTaskSource,
  GroupChat,
  GroupChatMember,
  GroupChatAdminConfig,
  UpdateGroupChatAdminConfigInput,
  UpdateGroupChatProfileInput,
  GroupSpeechPlan,
  GroupSpeechTask,
  GroupChatDetails,
} from './group/domain/GroupChat';
export type {
  GroupAssistantParticipant,
  GroupParticipantDirectory,
  GroupUserParticipant,
} from './group/domain/GroupParticipantDirectory';
export type {
  ConversationKind,
  ConversationRef,
} from './conversation/domain/ConversationRef';
export {
  conversationKeyOfDirect,
  conversationKeyOfGroup,
} from './conversation/domain/ConversationRef';

// Chat 拥有的 AI 工具：消息提交能力属于 Chat，不由调用方 Feature 自行落库。
export { SendMessageTool } from './aiTools/SendMessageTool';
export type {
  SendMessageArgs,
  SendMessageResultData,
} from './aiTools/SendMessageTool';

// AI 消息事实的观察入口；交付发布与内部 UI 信号仅由 Chat composition 使用。
export type {
  AIMessageDeliveryKind,
  AIMessageDeliveryStatus,
  AIMessageDeliveryReceipt,
  AIMessageObserverPayload,
  AIMessageReceivedPayload,
  AIMessageReceivedListener,
} from './reply/delivery/AIMessageEvents';
export {
  notifyAIMessageObservers,
  subscribeAIMessageReceived,
} from './reply/delivery/AIMessageEvents';

// 会话删除事实：普通调用方只可订阅，publisher 不属于此出口。
export type {
  PublicChatSessionDeleted,
} from './publicEvents';
export {
  subscribeToPublicChatSessionDeleted,
} from './publicEvents';

// Presentation facade。
export { default as BottomTabBar } from './presentation/messages/components/BottomTabBar';
export { default as ChatScreen } from './presentation/shell/ChatScreen';
export { ChatRouterProvider, useChatRouter } from './presentation/shell/ChatRouterContext';
export type { ChatRouterProviderProps } from './presentation/shell/ChatRouterContext';
export type { ChatSubScreen, GroupChatSubScreen } from './presentation/shell/chatScreenTypes';
export {
  ChatConversationRouteScreen,
  ChatFilePreviewRouteScreen,
  ChatMenuRouteScreen,
  ChatModelSettingsRouteScreen,
  ChatProtocolRouteScreen,
  ChatSettingsRouteScreen,
  ChatSummaryRouteScreen,
  ChatStatisticsRouteScreen,
  ChatSummaryEditorRouteScreen,
  CreateGroupRouteScreen,
  GroupAdminSettingsRouteScreen,
  GroupConversationRouteScreen,
  GroupFilePreviewRouteScreen,
  GroupMenuRouteScreen,
} from './presentation/shell/ChatRouteScreens';
export { getChatSummaryContext, createChatSummary, editChatSummary, deleteChatSummary, clearChatSummary,
} from './summary/application/ChatSummary';
export { subscribeChatSummaryChanged } from './summary/application/ChatSummaryRuntime';
export type { ChatSummarySegment, ChatSummarySnapshot } from './summary/domain/ChatSummaryRepository';

export { getChatImageModelSettings, selectChatImageModel, subscribeChatImageModelsChanged } from './reply/application/ChatImageModels';
export {
  getAssistantMessageArrivalSnapshot,
  subscribeAssistantMessageArrival,
} from './reply/delivery/AssistantMessageArrival';
