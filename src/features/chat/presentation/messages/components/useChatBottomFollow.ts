/** 拥有列表的贴底意图、触摸暂停和新消息提示；历史锚定仍由 FlashList 负责。 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import type { FlashListRef } from '@shopify/flash-list';
import type { ChatMessage } from '../../../messages/domain/ChatMessage';
import type { RenderedMessageItem } from './chatMessageRenderUtils';
import {
  classifyTailMutation,
  isNewMessagePromptEligible,
  resolveBottomFollowState,
  type MessageListSnapshot,
} from './chatMessageListState';

const AUTO_FOLLOW_BOTTOM_THRESHOLD_PX = 120;
type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

interface ChatBottomFollowOptions {
  sessionId: string | null | undefined;
  enableAssistantMessageSegmentation: boolean;
  paused: boolean;
  listRef: RefObject<FlashListRef<RenderedMessageItem> | null>;
  timelineMessages: readonly ChatMessage[];
  renderedData: readonly RenderedMessageItem[];
  onDismissInputSurface: () => void;
}

export function useChatBottomFollow({
  sessionId,
  enableAssistantMessageSegmentation,
  paused,
  listRef,
  timelineMessages,
  renderedData,
  onDismissInputSurface,
}: ChatBottomFollowOptions) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const isFollowingBottomRef = useRef(true);
  const isUserDraggingRef = useRef(false);
  const isTouchActiveRef = useRef(false);
  // 请求在按压期间保留，允许执行时才排帧；同一请求最多拥有一帧。
  const pendingFollowRef = useRef<{ frame: number | null } | null>(null);
  const previousSnapshotRef = useRef<MessageListSnapshot>({ keys: [] });
  const committedTimelineRef = useRef<readonly ChatMessage[]>([]);
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const renderedKeys = useMemo(() => renderedData.map((item) => item.key), [renderedData]);

  const cancelPendingFollow = useCallback(() => {
    const request = pendingFollowRef.current;
    if (request?.frame != null) cancelAnimationFrame(request.frame);
    pendingFollowRef.current = null;
  }, []);

  const requestBottomFollow = useCallback(() => {
    if (pausedRef.current || !isFollowingBottomRef.current) {
      cancelPendingFollow();
      return;
    }
    const request = pendingFollowRef.current ?? { frame: null };
    pendingFollowRef.current = request;
    // 自动滚动会让 ScrollView 接管 responder，不能打断点击、长按或拖动。
    if (isTouchActiveRef.current || isUserDraggingRef.current || request.frame !== null) return;
    request.frame = requestAnimationFrame(() => {
      request.frame = null;
      // 排帧之后仍可能开始按压；此时保留请求，交给触摸或滚动结束处理。
      if (isTouchActiveRef.current || isUserDraggingRef.current) return;
      pendingFollowRef.current = null;
      if (!pausedRef.current && isFollowingBottomRef.current) {
        listRef.current?.scrollToEnd({ animated: false });
      }
    });
  }, [cancelPendingFollow, listRef]);

  useEffect(() => {
    cancelPendingFollow();
    isFollowingBottomRef.current = true;
    isUserDraggingRef.current = false;
    isTouchActiveRef.current = false;
    previousSnapshotRef.current = { keys: [] };
    committedTimelineRef.current = [];
    setShowNewMessagePrompt(false);
  }, [sessionId, enableAssistantMessageSegmentation, cancelPendingFollow]);

  useEffect(() => cancelPendingFollow, [cancelPendingFollow]);

  const handleListLayoutCommit = useCallback(() => {
    const mutation = classifyTailMutation({
      previous: previousSnapshotRef.current,
      messages: renderedData.map((item) => item.msg),
      keys: renderedKeys,
    });
    if (mutation.type === 'initial' || (!pausedRef.current && isFollowingBottomRef.current)) {
      setShowNewMessagePrompt(false);
      // 仅消息事实的 append / 同身份更新触发跟随；局部展开与历史 prepend 保留阅读位置。
      if (committedTimelineRef.current !== timelineMessages
        && (mutation.type === 'append' || mutation.type === 'unchanged')) {
        requestBottomFollow();
      }
    } else if (mutation.type === 'append' && mutation.appendedMessages.some(isNewMessagePromptEligible)) {
      setShowNewMessagePrompt(true);
    }
    previousSnapshotRef.current = { keys: renderedKeys };
    committedTimelineRef.current = timelineMessages;
  }, [renderedData, renderedKeys, timelineMessages, requestBottomFollow]);

  const updateFollowState = useCallback((event: ScrollEvent, isUserInteracting: boolean) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const isNearBottom = contentSize.height - layoutMeasurement.height - contentOffset.y
      <= AUTO_FOLLOW_BOTTOM_THRESHOLD_PX;
    // 程序化滚动和内容增长不能取消用户的贴底意图。
    isFollowingBottomRef.current = resolveBottomFollowState({
      followingBottom: isFollowingBottomRef.current,
      isUserInteracting,
      isNearBottom,
    });
    if (isNearBottom) setShowNewMessagePrompt(false);
    if (!isFollowingBottomRef.current) cancelPendingFollow();
  }, [cancelPendingFollow]);

  const handleScroll = useCallback((event: ScrollEvent) => {
    updateFollowState(event, isUserDraggingRef.current);
    // 分页只读取真实滚动活动，不拥有或修改跟随状态。
    return isUserDraggingRef.current;
  }, [updateFollowState]);

  const handleScrollBeginDrag = useCallback(() => {
    isUserDraggingRef.current = true;
    // 原生确认拖动后收起面板，避免按下时改变视口、移动触摸目标。
    onDismissInputSurface();
  }, [onDismissInputSurface]);

  const handleMomentumScrollBegin = useCallback(() => {
    isUserDraggingRef.current = true;
  }, []);

  const handleUserScrollEnd = useCallback((event: ScrollEvent) => {
    updateFollowState(event, true);
    isUserDraggingRef.current = false;
    if (pendingFollowRef.current) requestBottomFollow();
  }, [updateFollowState, requestBottomFollow]);

  const handleTouchStart = useCallback(() => {
    isTouchActiveRef.current = true;
  }, []);

  const finishTouch = useCallback(() => {
    isTouchActiveRef.current = false;
    if (pendingFollowRef.current) requestBottomFollow();
  }, [requestBottomFollow]);

  const handleTouchEnd = useCallback(() => {
    onDismissInputSurface();
    finishTouch();
  }, [onDismissInputSurface, finishTouch]);

  const stopFollowingBottom = useCallback(() => {
    isFollowingBottomRef.current = false;
    cancelPendingFollow();
    setShowNewMessagePrompt(false);
  }, [cancelPendingFollow]);

  const handleNewMessagePromptPress = useCallback(() => {
    isFollowingBottomRef.current = true;
    cancelPendingFollow();
    listRef.current?.scrollToEnd({ animated: true });
    setShowNewMessagePrompt(false);
  }, [cancelPendingFollow, listRef]);

  return {
    showNewMessagePrompt,
    requestBottomFollow,
    stopFollowingBottom,
    handleListLayoutCommit,
    handleScroll,
    handleScrollBeginDrag,
    handleUserScrollEnd,
    handleMomentumScrollBegin,
    handleTouchStart,
    handleTouchEnd,
    finishTouch,
    handleNewMessagePromptPress,
  };
}
