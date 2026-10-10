/**
 * @fileoverview Chat application 类型断言入口
 *
 * 目的：校验聊天用例的直接导出与公共出口保持一致。
 */

import * as chatIndexTs from './index';

import {
  sendUserMessage,
  type AIAssistantConfig,
  type SendUserMessageParams,
  type SendUserMessageResult,
} from './messages/application/SendUserMessage';
import { requestProactiveChatReply } from './reply/application/RequestProactiveChatReply';
import {
  receiveExternalAIMessage,
  type ReceiveExternalAIMessageParams,
  type ReceiveExternalAIMessageResult,
} from './messages/application/ReceiveExternalAIMessage';
import {
  appendExternalAssistantMessage,
  appendExternalAssistantMessages,
} from './messages/application/AppendExternalAssistantMessages';
import { upsertCallTimelineEntry } from './messages/application/UpsertCallTimelineEntry';
import { resolveCanonicalConversation } from './conversation/application/ResolveCanonicalConversation';
import {
  messageTimeline,
  openConversationTimeline,
  loadOlderTimelineMessages,
  loadNewerTimelineMessages,
  subscribeConversationTimeline,
} from './messages/application/MessageTimeline';
import {
  listRecentChatTranscript,
  findCommittedAssistantMessageIdByRelatedSource,
  findFirstVisibleTimelineMessageByRunId,
  findFirstVisibleTimelineAnchorsByRunIds,
} from './messages/application/ChatReadQueries';
import { markChatMessagesReadByIds } from './messages/application/MarkChatMessagesReadByIds';

type Assert<T extends true> = T;
type IsEqual<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
    (<T>() => T extends Right ? 1 : 2)
    ? true
    : false;

// 公开 facade 的参数元组必须精确保持业务边界；若把 deps 通过可选第三参或
// 结构类型重新带回，这里的类型断言会在 typecheck 阶段失败。
type _SendUserMessagePublicParameters = Assert<IsEqual<
  Parameters<typeof chatIndexTs.sendUserMessage>,
  [SendUserMessageParams, AIAssistantConfig]
>>;
type _ReceiveExternalAIMessagePublicParameters = Assert<IsEqual<
  Parameters<typeof chatIndexTs.receiveExternalAIMessage>,
  [ReceiveExternalAIMessageParams]
>>;
type _SendUserMessageResultContract = Assert<IsEqual<
  Awaited<ReturnType<typeof chatIndexTs.sendUserMessage>>,
  SendUserMessageResult
>>;
type _ReceiveExternalAIMessageResultContract = Assert<IsEqual<
  Awaited<ReturnType<typeof chatIndexTs.receiveExternalAIMessage>>,
  ReceiveExternalAIMessageResult
>>;
const _sendUserMessagePublicParameters: _SendUserMessagePublicParameters = true;
const _receiveExternalAIMessagePublicParameters: _ReceiveExternalAIMessagePublicParameters = true;
const _sendUserMessageResultContract: _SendUserMessageResultContract = true;
const _receiveExternalAIMessageResultContract: _ReceiveExternalAIMessageResultContract = true;

const _sendUserMessage: typeof sendUserMessage = sendUserMessage;
const _sendUserMessageFromIndexTs: typeof sendUserMessage = chatIndexTs.sendUserMessage;

const _requestProactiveChatReply: typeof requestProactiveChatReply = requestProactiveChatReply;
const _requestProactiveChatReplyFromIndexTs: typeof requestProactiveChatReply =
  chatIndexTs.requestProactiveChatReply;

const _receiveExternalAIMessage: typeof receiveExternalAIMessage = receiveExternalAIMessage;
const _receiveExternalAIMessageFromIndexTs: typeof receiveExternalAIMessage = chatIndexTs.receiveExternalAIMessage;
const _appendExternalAssistantMessage: typeof appendExternalAssistantMessage = appendExternalAssistantMessage;
const _appendExternalAssistantMessageFromIndexTs: typeof appendExternalAssistantMessage = chatIndexTs.appendExternalAssistantMessage;
const _appendExternalAssistantMessages: typeof appendExternalAssistantMessages = appendExternalAssistantMessages;
const _appendExternalAssistantMessagesFromIndexTs: typeof appendExternalAssistantMessages = chatIndexTs.appendExternalAssistantMessages;
const _upsertCallTimelineEntry: typeof upsertCallTimelineEntry = upsertCallTimelineEntry;
const _upsertCallTimelineEntryFromIndexTs: typeof upsertCallTimelineEntry = chatIndexTs.upsertCallTimelineEntry;

const _resolveCanonicalConversation: typeof resolveCanonicalConversation = resolveCanonicalConversation;
const _resolveCanonicalConversationFromIndexTs: typeof resolveCanonicalConversation = chatIndexTs.resolveCanonicalConversation;

const _messageTimeline: typeof messageTimeline = messageTimeline;
const _messageTimelineFromIndexTs: typeof messageTimeline = chatIndexTs.messageTimeline;

const _openConversationTimeline: typeof openConversationTimeline = openConversationTimeline;
const _openConversationTimelineFromIndexTs: typeof openConversationTimeline =
  chatIndexTs.openConversationTimeline;
const _loadOlderTimelineMessages: typeof loadOlderTimelineMessages = loadOlderTimelineMessages;
const _loadOlderTimelineMessagesFromIndexTs: typeof loadOlderTimelineMessages =
  chatIndexTs.loadOlderTimelineMessages;
const _loadNewerTimelineMessages: typeof loadNewerTimelineMessages = loadNewerTimelineMessages;
const _loadNewerTimelineMessagesFromIndexTs: typeof loadNewerTimelineMessages =
  chatIndexTs.loadNewerTimelineMessages;
const _subscribeConversationTimeline: typeof subscribeConversationTimeline = subscribeConversationTimeline;
const _subscribeConversationTimelineFromIndexTs: typeof subscribeConversationTimeline = chatIndexTs.subscribeConversationTimeline;

const _listRecentChatTranscript: typeof listRecentChatTranscript = listRecentChatTranscript;
const _listRecentChatTranscriptFromIndexTs: typeof listRecentChatTranscript =
  chatIndexTs.listRecentChatTranscript;
const _findCommittedAssistantMessageIdByRelatedSource: typeof findCommittedAssistantMessageIdByRelatedSource =
  findCommittedAssistantMessageIdByRelatedSource;
const _findCommittedAssistantMessageIdByRelatedSourceFromIndexTs:
  typeof findCommittedAssistantMessageIdByRelatedSource =
  chatIndexTs.findCommittedAssistantMessageIdByRelatedSource;
const _findFirstVisibleTimelineMessageByRunId: typeof findFirstVisibleTimelineMessageByRunId =
  findFirstVisibleTimelineMessageByRunId;
const _findFirstVisibleTimelineMessageByRunIdFromIndexTs:
  typeof findFirstVisibleTimelineMessageByRunId =
  chatIndexTs.findFirstVisibleTimelineMessageByRunId;
const _findFirstVisibleTimelineAnchorsByRunIds: typeof findFirstVisibleTimelineAnchorsByRunIds =
  findFirstVisibleTimelineAnchorsByRunIds;
const _findFirstVisibleTimelineAnchorsByRunIdsFromIndexTs:
  typeof findFirstVisibleTimelineAnchorsByRunIds =
  chatIndexTs.findFirstVisibleTimelineAnchorsByRunIds;
const _markChatMessagesReadByIds: typeof markChatMessagesReadByIds = markChatMessagesReadByIds;
const _markChatMessagesReadByIdsFromIndexTs: typeof markChatMessagesReadByIds =
  chatIndexTs.markChatMessagesReadByIds;

void _sendUserMessage;
void _sendUserMessageFromIndexTs;
void _sendUserMessagePublicParameters;
void _receiveExternalAIMessagePublicParameters;
void _sendUserMessageResultContract;
void _receiveExternalAIMessageResultContract;
void _requestProactiveChatReply;
void _requestProactiveChatReplyFromIndexTs;
void _receiveExternalAIMessage;
void _receiveExternalAIMessageFromIndexTs;
void _appendExternalAssistantMessage;
void _appendExternalAssistantMessageFromIndexTs;
void _appendExternalAssistantMessages;
void _appendExternalAssistantMessagesFromIndexTs;
void _upsertCallTimelineEntry;
void _upsertCallTimelineEntryFromIndexTs;
void _resolveCanonicalConversation;
void _resolveCanonicalConversationFromIndexTs;
void _messageTimeline;
void _messageTimelineFromIndexTs;
void _openConversationTimeline;
void _openConversationTimelineFromIndexTs;
void _loadOlderTimelineMessages;
void _loadOlderTimelineMessagesFromIndexTs;
void _loadNewerTimelineMessages;
void _loadNewerTimelineMessagesFromIndexTs;
void _subscribeConversationTimeline;
void _subscribeConversationTimelineFromIndexTs;
void _listRecentChatTranscript;
void _listRecentChatTranscriptFromIndexTs;
void _findCommittedAssistantMessageIdByRelatedSource;
void _findCommittedAssistantMessageIdByRelatedSourceFromIndexTs;
void _findFirstVisibleTimelineMessageByRunId;
void _findFirstVisibleTimelineMessageByRunIdFromIndexTs;
void _findFirstVisibleTimelineAnchorsByRunIds;
void _findFirstVisibleTimelineAnchorsByRunIdsFromIndexTs;
void _markChatMessagesReadByIds;
void _markChatMessagesReadByIdsFromIndexTs;
