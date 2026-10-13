/** 构建并渲染聊天消息时间线，处理分段投影、分页加载、滚动跟随与消息交互。 */
import { getAssistantDisplayName } from '@features/assistants';

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';

import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import {
  buildSessionPreviewTextFromMessage,
  getMessageSticker,
  getMessageVoice,
  isToolStatusMessageMetadata,
  parseMessageMetadata,
  type ChatAttachment,
  type ParsedChatMessageMetadata,
} from '@features/chat/messages/domain';
import { formatMessageTime } from '@shared/utils/timeFormat';
import type { ChatDetailAIAssistantLike } from './chatTypes';
import { MessageListItem } from './ChatMessageListParts';
import { getChatSelectionKey } from '../../../messages/domain/ChatMessageSelection';
import {
  buildMessageBubbleRenderState,
  areRenderedMessageItemsEquivalent,
  getMessageListItemType,
  type RenderedMessageItem,
  type ResolvedMessageAIIdentity,
  type MessageTranslationBlock,
} from './chatMessageRenderUtils';
import { createLayoutProbeCellRenderer } from '../MessageBubble/layoutProbe';
import {
  buildTogetherListeningActivityCardViewModel,
  parseTogetherListeningMessageMetadata,
} from './togetherListeningCardViewModel';
import type { ChatTogetherListeningResult } from '../../../conversation/application/ChatTogetherListeningGateway';
import {
  collapseAssistantSegmentsForPresentation,
  getAssistantPresentationGroupKey,
  hidePersistedReasoningDuplicatesForPresentation,
  ownsCanonicalSegmentedAssistantPresentation,
  shouldCollapseAssistantSegment,
} from './chatMessagePresentation';
import { buildToolStatusProcessCard } from './chatToolStatusPresentation';
import {
  filterReasoningMessagesForPresentation,
  getLastPresentationTimelineMessage,
  renderedItemContainsMessageId,
  segmentContiguousAgentActions,
} from './chatActionGrouping';
import {
  computeRunTailFlagsForTimeline,
  resolvePresentationRunIdentity,
} from './chatPresentationRun';
import { createMessageListStyles } from './chatStyles';
import { useAgentTransientTimeline } from './useAgentTransientTimeline';
import {
  getAgentTimelineMessageIdentity,
  getAgentTimelineRenderKey,
} from '@features/chat/messages/application/AgentTransientTimeline';
import { getChatInteractionProfile, useTheme } from '@shared/theme';
import {
  classifyTailMutation,
  isNewMessagePromptEligible,
  resolveBottomFollowState,
  shouldShowTimeSeparator,
  type MessageListSnapshot,
} from './chatMessageListState';
import {
  IDLE_HISTORY_PAGINATION_GATE,
  applyScrollDemandToGate,
  beginHistoryPageRequest,
  beginHistoryPaginationGeneration,
  finishHistoryPageRequest,
  resolveScrollDemandDecision,
  shouldRequestBootstrapPage,
  type HistoryPaginationGate,
} from './chatHistoryPagination';
import { useArrivedAssistantMessages } from './useArrivedAssistantMessages';

const AUTO_FOLLOW_BOTTOM_THRESHOLD_PX = 120;
const EMPTY_ATTACHMENTS: ChatAttachment[] = [];
/** 主动生活 anchor 定位最多向前追加的历史分页次数，避免为定位无限翻历史。 */
const ANCHOR_MAX_PAGE_ATTEMPTS = 4;

/**
 * 历史分页请求的来源。
 *
 * 只有 scroll / queued-scroll 来自用户滚动 demand；anchor 是定位谓词，
 * bootstrap 只解决"内容不足一屏"，三者共享同一个执行入口与 in-flight 互斥。
 */
type OlderPageRequestReason = 'scroll' | 'queued-scroll' | 'anchor' | 'bootstrap';

/**
 * 消息列表组件的属性定义
 */
interface ChatMessageListProps {
  hiddenRunId?: string | null;
  sessionId?: string | null;
  /**
   * 消息列表数据
   * @default undefined
   */
  messages?: ChatMessage[];

  /**
   * AI 助手相关配置或数据，为 null 表示无 AI 助手
   */
  aiAssistant?: ChatDetailAIAssistantLike | null;

  /**
   * 当前系统可用 AI 列表，用于按消息归因解析 helper 头像
   */
  aiAssistants?: ChatDetailAIAssistantLike[];

  /**
   * 当前用户头像，可以是 URL、React 元素或其他任意类型，由组件内部处理
   */
  userAvatar?: unknown;

  /**
   * 当前用户名称
   */
  userName?: string;

  /**
   * 群聊场景：在 AI 气泡上方显示发送者名，用于区分多个 AI
   */
  showAssistantName?: boolean;

  /**
   * 长按某条消息时的回调函数
   * @param msg - 被长按的消息对象
   */
  onMessageLongPress?: (msg: ChatMessage, position: { x: number; y: number }) => void;

  /**
   * 加载更多历史消息的回调，通常在滚动到顶部时触发
   * @returns 可以返回 boolean 表示是否成功，或返回 Promise<boolean> 进行异步处理
   */
  onLoadMore?: () => Promise<boolean> | boolean | void;

  /**
   * 是否还有更多历史消息可供加载（必填）
   */
  hasMore: boolean;

  /**
   * 是否正在加载更多消息（必填），用于展示加载状态
   */
  isLoadingMore: boolean;

  /**
   * 重试发送失败消息的回调
   * @param messageId - 失败消息的 ID
   */
  onRetryMessage?: (messageId: number) => void;

  translations?: Record<number, MessageTranslationBlock>;

  onHideTranslation?: (messageId: number) => void;

  /**
   * 预览文件的回调
   * @param params - 文件预览参数
   */
  onPreviewFile: (params: { fileUri: string; fileName: string; mimeType?: string | null }) => void;

  /**
   * 当前被长按选中的消息 ID，用于高亮该消息
   */
  selectedMessageId?: number | null;
  /** 分享预览覆盖来源页时保持阅读位置，直到恢复页面交互。 */
  pauseAutoScroll?: boolean;
  selection?: {
    selectedKeys: ReadonlySet<string>;
    availableKeys: ReadonlySet<string>;
    disabled: boolean;
    onToggle: (key: string) => void;
  };
  expandedVoiceTranscriptIds?: ReadonlySet<number>;
  /**
   * 主动生活「查看当时的聊天」传入的一次性定位目标；
   * null/undefined 表示正常进入会话，定位失败时静默保持默认底部位置。
   */
  anchorMessageId?: number | null;
  onTogetherListeningAccept?: TogetherListeningCardActionHandler;
  onTogetherListeningDecline?: TogetherListeningCardActionHandler;
  onTogetherListeningLeave?: TogetherListeningCardActionHandler;
  onDismissInputSurface: () => void;
}

type TogetherListeningCardActionHandler = (
  activityId: string,
) => Promise<ChatTogetherListeningResult>;

function getAttachmentsFromMetadata(
  metadata: ParsedChatMessageMetadata | null | undefined
): ChatAttachment[] {
  const attachments = metadata?.attachments;
  return Array.isArray(attachments) && attachments.length > 0 ? attachments : EMPTY_ATTACHMENTS;
}

function buildBubbleTextFromMessage(message: ChatMessage, attachments: ChatAttachment[]) {
  if (String(message.text || '').trim()) {
    return message.text;
  }

  if (attachments.length > 0) {
    return '';
  }

  return buildSessionPreviewTextFromMessage(message);
}

function resolveMessageAIIdentity(
  message: ChatMessage,
  metadata: ParsedChatMessageMetadata | null | undefined,
  aiAssistant?: ChatDetailAIAssistantLike | null,
  aiAssistants: ChatDetailAIAssistantLike[] = []
): ResolvedMessageAIIdentity {
  const primaryIdentity: ResolvedMessageAIIdentity = {
    aiId: aiAssistant?.id || null,
    agentId: aiAssistant?.agentId || null,
    name: aiAssistant ? getAssistantDisplayName(aiAssistant) : null,
    avatar: aiAssistant?.avatar || null,
  };

  if (message.isMe || message.senderType !== 'assistant') {
    return primaryIdentity;
  }

  const helperMetadata = metadata?.helper;
  const resolvedAgentId = message.agentId || helperMetadata?.actorAgentId || null;
  const resolvedAIId = helperMetadata?.actorAIId || helperMetadata?.helperAIId || null;
  const isHelperReply = helperMetadata?.kind === 'helper_reply';
  const differsFromPrimary = Boolean(
    resolvedAgentId &&
    primaryIdentity.agentId &&
    resolvedAgentId !== primaryIdentity.agentId
  );

  if (!isHelperReply && !differsFromPrimary) {
    return primaryIdentity;
  }

  const matchedAssistant =
    aiAssistants.find((assistant) => {
      if (resolvedAIId && assistant.id === resolvedAIId) {
        return true;
      }

      if (resolvedAgentId && assistant.agentId === resolvedAgentId) {
        return true;
      }

      return false;
    }) || null;

  return {
    aiId: matchedAssistant?.id || resolvedAIId,
    agentId: matchedAssistant?.agentId || resolvedAgentId,
    name: matchedAssistant ? getAssistantDisplayName(matchedAssistant) : null,
    avatar: matchedAssistant?.avatar || null,
  };
}

function ChatMessageList({
  hiddenRunId,
  sessionId,
  messages = [],
  aiAssistant,
  aiAssistants = [],
  userAvatar,
  userName,
  showAssistantName = false,
  onMessageLongPress,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onRetryMessage,
  translations = {},
  onHideTranslation,
  onPreviewFile,
  selectedMessageId,
  pauseAutoScroll = false,
  selection,
  expandedVoiceTranscriptIds = new Set<number>(),
  anchorMessageId = null,
  onTogetherListeningAccept,
  onTogetherListeningDecline,
  onTogetherListeningLeave,
  onDismissInputSurface,
}: ChatMessageListProps) {
  const theme = useTheme();
  const styles = useMemo(() => createMessageListStyles(theme), [theme]);
  const interactionProfile = getChatInteractionProfile(theme);
  // 非流式多气泡主题消费统一的分段到达投影。
  const isCanonicalSegmentedAssistant = ownsCanonicalSegmentedAssistantPresentation(
    interactionProfile
  );
  const { messages: completeTimelineMessages } = useAgentTransientTimeline(
    sessionId,
    messages,
    { suppressTransientAssistantText: isCanonicalSegmentedAssistant },
  );
  const visibleTimelineMessages = useMemo(() => completeTimelineMessages.filter((message) =>
    !hiddenRunId || message.turnRunId !== hiddenRunId || message.turnItemIndex == null
  ), [completeTimelineMessages, hiddenRunId]);
  const timelineMessages = useArrivedAssistantMessages(visibleTimelineMessages, isCanonicalSegmentedAssistant);
  const bottomFollowPausedRef = useRef(Boolean(selection) || pauseAutoScroll);
  bottomFollowPausedRef.current = Boolean(selection) || pauseAutoScroll;
  const listRef = useRef<FlashListRef<RenderedMessageItem> | null>(null);
  const isFollowingBottomRef = useRef(true);
  const isUserDraggingRef = useRef(false);
  const followBottomFrameRef = useRef<number | null>(null);
  const anchorConsumedRef = useRef(false);
  const anchorPageAttemptsRef = useRef(0);
  const anchorFrameRef = useRef<number | null>(null);
  const previousSnapshotRef = useRef<MessageListSnapshot>({ keys: [] });
  const committedTimelineRef = useRef<readonly ChatMessage[]>([]);
  const renderedItemCacheRef = useRef(new Map<string, RenderedMessageItem>());
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const [isListScrollEnabled, setIsListScrollEnabled] = useState(true);

  // 历史分页状态。全部走 ref：滚动回调每次都会读写它们，
  // 不能为了分页水位引入额外的 React render。
  //
  // gate 自带 generation：session 切换时推进 generation 并建立全新的 idle gate，
  // 旧请求的 finally 因此只能看到「generation 不匹配」，无法污染新会话的分页门。
  const olderPageGateRef = useRef<HistoryPaginationGate>(IDLE_HISTORY_PAGINATION_GATE);
  const previousContentOffsetYRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  /**
   * 内容真实高度；`null` 表示尚未经过 `onContentSizeChange` 测量。
   *
   * 不能退化成 `0`：list layout 与 content size 是两条独立回调，后者可能晚到，
   * 而 bootstrap 谓词问的是「内容是否真的不足 1.2 屏」——未测量不是「高度为 0」。
   */
  const contentHeightRef = useRef<number | null>(null);
  const hasMoreRef = useRef(hasMore);
  const onLoadMoreRef = useRef(onLoadMore);
  /** requestOlderPage 会在自己的 finally 里再次调用自己，用 ref 断开 useCallback 循环引用。 */
  const requestOlderPageRef = useRef<(reason: OlderPageRequestReason) => Promise<boolean>>(
    async () => false
  );

  hasMoreRef.current = hasMore;
  onLoadMoreRef.current = onLoadMore;

  /**
   * 历史分页的唯一执行入口（scroll / queued-scroll / anchor / bootstrap 共用）。
   *
   * 只负责互斥与 token 消费，不自己制造 demand：请求结束后最多消费一个
   * 「加载期间由真实滚动留下的」token，消费完就停，不会因为数据落地继续翻页。
   *
   * 请求开始时捕获当前 generation；结束时若 gate 已经属于新的 generation
   * （session 切换会推进它），整个 finally 完全 no-op —— 不碰新 gate 的 in-flight、
   * 不消费新 gate 的排队 token、也不触发 queued-scroll。
   */
  const requestOlderPage = useCallback(
    async (reason: OlderPageRequestReason): Promise<boolean> => {
      const loadMore = onLoadMoreRef.current;
      if (!loadMore) {
        return false;
      }

      const started = beginHistoryPageRequest(olderPageGateRef.current, {
        hasMore: hasMoreRef.current,
      });

      if (!started) {
        return false;
      }

      olderPageGateRef.current = started.gate;
      const request = started.request;

      try {
        return Boolean(await Promise.resolve(loadMore()));
      } catch (error) {
        console.error(`[ChatMessageList] Failed to load older messages (${reason}):`, error);
        return false;
      } finally {
        const finished = finishHistoryPageRequest(olderPageGateRef.current, request, {
          hasMore: hasMoreRef.current,
        });

        if (finished) {
          olderPageGateRef.current = finished.gate;

          if (finished.shouldRequestQueued) {
            void requestOlderPageRef.current('queued-scroll');
          }
        }
      }
    },
    []
  );

  requestOlderPageRef.current = requestOlderPage;

  useEffect(() => {
    isFollowingBottomRef.current = true;
    isUserDraggingRef.current = false;
    previousSnapshotRef.current = { keys: [] };
    committedTimelineRef.current = [];
    anchorConsumedRef.current = false;
    anchorPageAttemptsRef.current = 0;
    // 推进 generation 而不是复用同一个 idle gate：这样上一个会话在飞的请求
    // 结束后拿着的 request token 已经不属于当前 gate，它的 finally 只能 no-op。
    olderPageGateRef.current = beginHistoryPaginationGeneration(olderPageGateRef.current);
    previousContentOffsetYRef.current = null;
    contentHeightRef.current = null;
    viewportHeightRef.current = 0;
    setShowNewMessagePrompt(false);
    setIsListScrollEnabled(true);
    renderedItemCacheRef.current.clear();
  }, [sessionId, interactionProfile.enableAssistantMessageSegmentation]);

  const followBottomAfterLayout = useCallback(() => {
    if (bottomFollowPausedRef.current || !isFollowingBottomRef.current) {
      return;
    }
    if (followBottomFrameRef.current !== null) {
      cancelAnimationFrame(followBottomFrameRef.current);
    }
    followBottomFrameRef.current = requestAnimationFrame(() => {
      followBottomFrameRef.current = null;
      if (!bottomFollowPausedRef.current && isFollowingBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    });
  }, []);

  useEffect(() => () => {
    if (followBottomFrameRef.current !== null) {
      cancelAnimationFrame(followBottomFrameRef.current);
    }
    if (anchorFrameRef.current !== null) {
      cancelAnimationFrame(anchorFrameRef.current);
    }
  }, []);

  const renderedData = useMemo<RenderedMessageItem[]>(() => {
    if (!timelineMessages.length) {
      renderedItemCacheRef.current.clear();
      return [];
    }

    const presentationMessages = collapseAssistantSegmentsForPresentation(
      hidePersistedReasoningDuplicatesForPresentation(
        timelineMessages
      ),
      interactionProfile
    );
    // footer/run-tail 属于 canonical presentation timeline 上的消息事实，先于 ActionGroup
    // 包装计算，避免展示容器抢走 assistant output tail。
    const runTailFlags = computeRunTailFlagsForTimeline(presentationMessages);
    const visibleMessages = filterReasoningMessagesForPresentation(
      presentationMessages,
      interactionProfile.showReasoningMessages
    );
    // ActionGroup 是可见 timeline 的结构语义；surface 只在渲染组件内决定外观。
    const presentationItems = segmentContiguousAgentActions(visibleMessages);
    const nextRenderedItemCache = new Map<string, RenderedMessageItem>();
    const nextRenderedData = new Array<RenderedMessageItem>(presentationItems.length);
    let previousSpeakerIsMe: boolean | null = null;

    for (let sourceIndex = 0; sourceIndex < presentationItems.length; sourceIndex += 1) {
      const presentationItem = presentationItems[sourceIndex];
      const actionGroup = presentationItem.kind === 'action-group' ? presentationItem : null;
      const msg = presentationItem.kind === 'action-group'
        ? presentationItem.children[0]
        : presentationItem.message;
      const previousPresentationItem = sourceIndex > 0 ? presentationItems[sourceIndex - 1] : null;
      const previousMessage = previousPresentationItem
        ? getLastPresentationTimelineMessage(previousPresentationItem)
        : null;
      const stableAgentIdentity = getAgentTimelineMessageIdentity(msg);
      let key = actionGroup?.key ?? getAgentTimelineRenderKey(msg);
      if (
        !actionGroup
        &&
        !stableAgentIdentity
        && shouldCollapseAssistantSegment(msg, interactionProfile)
        && msg.logicalMessageId
      ) {
        key = `logical_assistant_${getAssistantPresentationGroupKey(msg)}`;
      }
      const metadata = parseMessageMetadata(msg);
      const attachments = getAttachmentsFromMetadata(metadata);
      const sticker = getMessageSticker(msg);
      const voice = getMessageVoice(msg);
      const bubbleText = sticker || voice ? '' : buildBubbleTextFromMessage(msg, attachments);
      const processCard = actionGroup
        ? null
        : buildToolStatusProcessCard(metadata, interactionProfile.toolStatusSurface);
      const resolvedAIIdentity = resolveMessageAIIdentity(msg, metadata, aiAssistant, aiAssistants);
      const togetherListeningMetadata = parseTogetherListeningMessageMetadata(metadata);
      const togetherListeningCard = togetherListeningMetadata
        ? buildTogetherListeningActivityCardViewModel(togetherListeningMetadata)
        : null;
      // 发言切换属于可见列表的相邻关系；工具过程归 AI，中性系统事件不打断发言者。
      const speakerIsMe = actionGroup
        ? false
        : togetherListeningCard
          ? togetherListeningCard.isMe
          : msg.senderType === 'user' || msg.senderType === 'assistant'
            ? msg.isMe
            : null;
      const showSpeakerSeparator = speakerIsMe !== null
        && previousSpeakerIsMe !== null
        && speakerIsMe !== previousSpeakerIsMe;
      if (speakerIsMe !== null) {
        previousSpeakerIsMe = speakerIsMe;
      }
      const bubbleRenderState = buildMessageBubbleRenderState({
        text: bubbleText,
        isMe: msg.isMe,
        senderType: msg.senderType,
        replyToText: msg.replyToText,
        hasReplyQuote: Boolean(metadata?.replyQuote),
        attachments,
        sticker,
        voice,
        isToolStatusMessage: isToolStatusMessageMetadata(metadata),
        isSharedRecord: metadata?.kind === 'shared_record',
      });
      const tailFlags = actionGroup
        ? runTailFlags.get(actionGroup.children[actionGroup.children.length - 1])
        : runTailFlags.get(msg);
      const nextItem: RenderedMessageItem = {
        msg,
        actionGroup,
        showTimeSeparator: shouldShowTimeSeparator(msg, previousMessage),
        showSpeakerSeparator,
        timeText: formatMessageTime(msg.createdAt),
        displayTokensUsed: aiAssistant?.showTokenUsage === false ? 0 : msg.tokensUsed || 0,
        bubbleText,
        attachments,
        sticker,
        voice,
        resolvedAIIdentity,
        bubbleRenderState,
        translation: translations[msg.id] || null,
        processCard,
        togetherListeningCard,
        isAssistantOutputTail: actionGroup ? false : tailFlags?.isAssistantOutputTail ?? false,
        isRunTail: tailFlags?.isRunTail ?? false,
        presentationRunKey: actionGroup?.runKey ?? resolvePresentationRunIdentity(msg).key,
        key,
      };
      const cachedItem = renderedItemCacheRef.current.get(key);

      if (cachedItem && areRenderedMessageItemsEquivalent(cachedItem, nextItem)) {
        nextRenderedItemCache.set(key, cachedItem);
        nextRenderedData[sourceIndex] = cachedItem;
        continue;
      }

      nextRenderedItemCache.set(key, nextItem);
      nextRenderedData[sourceIndex] = nextItem;
    }

    renderedItemCacheRef.current = nextRenderedItemCache;
    return nextRenderedData;
  }, [timelineMessages, aiAssistant, aiAssistants, translations, interactionProfile]);

  const renderedMessageKeys = useMemo(
    () => renderedData.map((item) => item.key),
    [renderedData]
  );

  const handleListLayoutCommit = useCallback(() => {
    if (!timelineMessages.length) {
      previousSnapshotRef.current = { keys: [] };
      committedTimelineRef.current = timelineMessages;
      return;
    }

    const mutation = classifyTailMutation({
      previous: previousSnapshotRef.current,
      messages: renderedData.map((item) => item.msg),
      keys: renderedMessageKeys,
    });

    if (mutation.type === 'initial' || (!bottomFollowPausedRef.current && isFollowingBottomRef.current)) {
      setShowNewMessagePrompt(false);
      // 跟随只消费消息事实变化；展开思维链等局部布局变化应保留阅读位置。
      // 在 FlashList 提交布局后再滚动，同一条消息的流式增长也走这个入口。
      if (
        committedTimelineRef.current !== timelineMessages
        && (mutation.type === 'append' || mutation.type === 'unchanged')
      ) {
        followBottomAfterLayout();
      }
    } else if (
      mutation.type === 'append'
      && mutation.appendedMessages.some(isNewMessagePromptEligible)
    ) {
      setShowNewMessagePrompt(true);
    }

    previousSnapshotRef.current = { keys: renderedMessageKeys };
    committedTimelineRef.current = timelineMessages;
  }, [followBottomAfterLayout, renderedData, renderedMessageKeys, timelineMessages]);

  // 主动生活「查看当时的聊天」一次性定位：目标消息在当前窗口内则直接滚动过去；
  // 不在时有限追加历史分页再试，仍找不到就保持默认底部位置，不影响正常进入会话。
  //
  // anchor 与滚动共用同一个执行入口和 in-flight，但谓词不同：它不要求位于顶部水位，
  // 只看目标消息是否已进入窗口，并受 ANCHOR_MAX_PAGE_ATTEMPTS 限制。
  useEffect(() => {
    if (anchorMessageId == null || anchorConsumedRef.current || renderedData.length === 0) {
      return;
    }
    const anchorIndex = renderedData.findIndex(
      (item) => renderedItemContainsMessageId(item, anchorMessageId)
    );
    if (anchorIndex >= 0) {
      anchorConsumedRef.current = true;
      isFollowingBottomRef.current = false;
      setShowNewMessagePrompt(false);
      anchorFrameRef.current = requestAnimationFrame(() => {
        anchorFrameRef.current = null;
        listRef.current?.scrollToIndex({ index: anchorIndex, viewPosition: 0.35, animated: false });
      });
      return;
    }
    if (isLoadingMore || olderPageGateRef.current.inFlight) {
      return;
    }
    if (!hasMore || anchorPageAttemptsRef.current >= ANCHOR_MAX_PAGE_ATTEMPTS) {
      anchorConsumedRef.current = true;
      return;
    }
    anchorPageAttemptsRef.current += 1;
    void requestOlderPageRef.current('anchor');
  }, [anchorMessageId, renderedData, hasMore, isLoadingMore]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const isNearBottom = distanceFromBottom <= AUTO_FOLLOW_BOTTOM_THRESHOLD_PX;

    // 内容增长和程序化滚动不能改变用户意图；只有用户手势可以退出 follow。
    isFollowingBottomRef.current = resolveBottomFollowState({
      followingBottom: isFollowingBottomRef.current,
      isUserInteracting: isUserDraggingRef.current,
      isNearBottom,
    });

    if (isNearBottom) {
      isFollowingBottomRef.current = true;
      setShowNewMessagePrompt(false);
    }

    const decision = resolveScrollDemandDecision({
      contentOffsetY: contentOffset.y,
      previousContentOffsetY: previousContentOffsetYRef.current,
      viewportHeight: layoutMeasurement.height,
      hasMore: hasMoreRef.current,
      isPageInFlight: olderPageGateRef.current.inFlight,
      isUserScrollActive: isUserDraggingRef.current,
    });

    previousContentOffsetYRef.current = contentOffset.y;

    if (decision === 'request') {
      void requestOlderPageRef.current('scroll');
      return;
    }

    olderPageGateRef.current = applyScrollDemandToGate(olderPageGateRef.current, decision);
  }, []);

  const handleScrollBeginDrag = useCallback(() => {
    isUserDraggingRef.current = true;
  }, []);

  const updateFollowStateAtUserScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
      const isNearBottom = distanceFromBottom <= AUTO_FOLLOW_BOTTOM_THRESHOLD_PX;
      isFollowingBottomRef.current = resolveBottomFollowState({
        followingBottom: isFollowingBottomRef.current,
        isUserInteracting: true,
        isNearBottom,
      });
      isUserDraggingRef.current = false;
      if (isNearBottom) {
        setShowNewMessagePrompt(false);
      }
    },
    []
  );

  const handleNestedScrollActiveChange = useCallback((isActive: boolean) => {
    // Do not remove casually: this is the FlashList side of the Moon Kimi reasoning
    // nested-scroll handshake, and prevents the parent list from stealing child drags.
    setIsListScrollEnabled((previous) => {
      const next = !isActive;
      return previous === next ? previous : next;
    });
  }, []);

  const selectionControls = useMemo(() => {
    const controls = new Set<string>();
    const seen = new Set<string>();
    if (!selection) return controls;
    for (const item of renderedData) {
      const key = getChatSelectionKey(item.msg);
      const type = parseMessageMetadata(item.msg)?.type;
      if (selection.availableKeys.has(key) && (!type || type === 'toolStatus') && !seen.has(key)) {
        seen.add(key);
        controls.add(item.key);
      }
    }
    return controls;
  }, [renderedData, selection]);
  const selectionKeyForItem = useCallback((item: RenderedMessageItem) => {
    const key = getChatSelectionKey(item.msg);
    const type = parseMessageMetadata(item.msg)?.type;
    return selection?.availableKeys.has(key) && (!type || type === 'toolStatus') ? key : undefined;
  }, [selection]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RenderedMessageItem>) => (
      <MessageListItem
        item={item}
        userAvatar={userAvatar}
        userName={userName}
        showAssistantName={showAssistantName}
        isSelected={selection ? selection.selectedKeys.has(getChatSelectionKey(item.msg)) && Boolean(selectionKeyForItem(item)) : item.msg.id === selectedMessageId}
        selectionMode={Boolean(selection)}
        selectionKey={selectionKeyForItem(item)}
        showSelectionControl={selectionControls.has(item.key)}
        selectionDisabled={selection?.disabled}
        onToggleSelection={selection?.onToggle}
        isVoiceTranscriptExpanded={expandedVoiceTranscriptIds.has(item.msg.id)}
        onMessageLongPress={onMessageLongPress}
        onRetryMessage={onRetryMessage}
        onHideTranslation={onHideTranslation}
        onPreviewFile={onPreviewFile}
        onNestedScrollActiveChange={handleNestedScrollActiveChange}
        onTogetherListeningAccept={onTogetherListeningAccept}
        onTogetherListeningDecline={onTogetherListeningDecline}
        onTogetherListeningLeave={onTogetherListeningLeave}
      />
    ),
    [
      userAvatar,
      userName,
      showAssistantName,
      selectedMessageId,
      selection,
      selectionControls,
      selectionKeyForItem,
      expandedVoiceTranscriptIds,
      onMessageLongPress,
      onRetryMessage,
      onHideTranslation,
      onPreviewFile,
      handleNestedScrollActiveChange,
      onTogetherListeningAccept,
      onTogetherListeningDecline,
      onTogetherListeningLeave,
    ]
  );

  const keyExtractor = useCallback((item: RenderedMessageItem) => item.key, []);

  // 开发态布局探针：FlashList 自己测量并缓存 cell 尺寸（`dist/recyclerview/ViewHolder.js`），
  // 只有通过 `CellRendererComponent` 才能拿到 cell 这一层的真实 onLayout（它的 y 就是消息在
  // 列表内容里的偏移）。`createLayoutProbeCellRenderer` 在探针关闭时返回 undefined，
  // FlashList 于是使用默认容器，渲染树与生产完全一致。
  //
  // data 走 ref 而不是 effect 同步：cell 的首次 onLayout 与本次 commit 同批到达，
  // 用 effect 会晚一帧，把 index 解析成上一条消息。
  const probeDataRef = useRef(renderedData);
  probeDataRef.current = renderedData;
  const resolveProbeIdentity = useCallback((index: number) => {
    const item = probeDataRef.current[index];
    if (!item) {
      return undefined;
    }
    return {
      messageId: item.msg.id,
      senderType: item.msg.senderType,
      isMe: item.msg.isMe,
      themeId: theme.id,
      presentationRunKey: item.presentationRunKey ?? null,
    };
  }, [theme.id]);
  const probeCellRenderer = useMemo(
    () => createLayoutProbeCellRenderer(resolveProbeIdentity),
    [resolveProbeIdentity]
  );

  const handleNewMessagePromptPress = useCallback(() => {
    isFollowingBottomRef.current = true;
    listRef.current?.scrollToEnd({ animated: true });
    setShowNewMessagePrompt(false);
  }, []);

  /**
   * 内容高度不足以产生滚动时的补页。
   *
   * 展示层折叠（ActionGroup、assistant segment collapse）会让原始
   * messages 很多但实际高度不足一屏，用户根本滚不动，也就永远产生不了滚动 demand。
   * 这里只在内容 <= 1.2 屏时补页，一旦内容足够滚动就交回滚动 demand 模型。
   */
  const requestBootstrapPageIfContentTooShort = useCallback(() => {
    const shouldBootstrap = shouldRequestBootstrapPage({
      contentHeight: contentHeightRef.current,
      viewportHeight: viewportHeightRef.current,
      hasMore: hasMoreRef.current,
      isPageInFlight: olderPageGateRef.current.inFlight,
    });

    if (!shouldBootstrap) {
      return;
    }

    void requestOlderPageRef.current('bootstrap');
  }, []);

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      // 这里只记录真实测量结果。prepend 引起的 offset 修正由滚动方向判断挡掉，
      // 不再需要「紧随其后的第一次滚动视为修正」这类布尔标记——它会被 reasoning
      // 展开、图片尺寸完成等没有后续滚动的事件永久挂着，反过来吞掉真实上滑。
      contentHeightRef.current = height;
      requestBootstrapPageIfContentTooShort();
    },
    [requestBootstrapPageIfContentTooShort]
  );

  const handleListLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const previousHeight = viewportHeightRef.current;
      const height = event.nativeEvent.layout.height;
      viewportHeightRef.current = height;
      // 视口高度由布局回调拥有；滚动事件可能先报告新高度，不能提前覆盖比较基准。
      // 键盘或输入面板改变视口时保留贴底意图，消息自身展开不改变视口。
      if (previousHeight > 0 && height !== previousHeight) {
        followBottomAfterLayout();
      }
      requestBootstrapPageIfContentTooShort();
    },
    [followBottomAfterLayout, requestBootstrapPageIfContentTooShort]
  );

  if (!timelineMessages.length) {
    if (interactionProfile.emptyStateSurface === 'official-replica') {
      return (
        <Pressable style={styles.officialReplicaEmptyContainer} onPress={onDismissInputSurface}>
          <View style={styles.officialReplicaEmptyMark}>
            <Ionicons name="sparkles-outline" size={24} color={theme.colors.icon.secondary} />
          </View>
          <Text style={styles.officialReplicaEmptyTitle}>Kimi</Text>
          <Text style={styles.officialReplicaEmptySubtitle}>尽管问，带图也行</Text>
        </Pressable>
      );
    }

    return (
      <Pressable style={styles.emptyContainer} onPress={onDismissInputSurface}>
        <Text style={styles.emptyText}>暂无消息，开始聊天吧~</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.container} onTouchStart={onDismissInputSurface}>
      <FlashList
        key={sessionId || 'message_list'}
        ref={listRef}
        data={renderedData}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        getItemType={getMessageListItemType}
        CellRendererComponent={probeCellRenderer}
        nestedScrollEnabled
        scrollEnabled={isListScrollEnabled}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator
        keyboardDismissMode="none"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        maintainVisibleContentPosition={{
          startRenderingFromBottom: true,
        }}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={updateFollowStateAtUserScrollEnd}
        onMomentumScrollBegin={() => {
          isUserDraggingRef.current = true;
        }}
        onMomentumScrollEnd={updateFollowStateAtUserScrollEnd}
        onLayout={handleListLayout}
        onCommitLayoutEffect={handleListLayoutCommit}
        onContentSizeChange={handleContentSizeChange}
      />
      {showNewMessagePrompt ? (
        <Pressable
          style={styles.newMessagePrompt}
          onPress={handleNewMessagePromptPress}
          accessibilityRole="button"
          accessibilityLabel="查看新消息"
        >
          <Ionicons name="arrow-down" size={18} color={theme.colors.brand.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export default memo(ChatMessageList);
