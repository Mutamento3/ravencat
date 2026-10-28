/** 拥有列表的贴底意图、触摸暂停和新消息提示；历史锚定仍由 FlashList 负责。 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { PixelRatio, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
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
  listRef: RefObject<Pick<FlashListRef<unknown>,
    'scrollToEnd' | 'scrollToOffset' | 'getChildContainerDimensions' | 'getFirstItemOffset'
    | 'getWindowSize' | 'getAbsoluteLastScrollOffset'
  > | null>;
  contentPaddingBottom: number;
  timelineMessages: readonly ChatMessage[];
  renderedData: readonly RenderedMessageItem[];
  onDismissInputSurface: () => void;
}

export function useChatBottomFollow({
  sessionId,
  enableAssistantMessageSegmentation,
  paused,
  listRef,
  contentPaddingBottom,
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
  const nativeContentHeightRef = useRef<number | null>(null);
  const previousSnapshotRef = useRef<MessageListSnapshot>({ keys: [] });
  const committedTimelineRef = useRef<readonly ChatMessage[]>([]);
  const [showNewMessagePrompt, setShowNewMessagePrompt] = useState(false);
  const renderedKeys = useMemo(() => renderedData.map((item) => item.key), [renderedData]);

  const cancelPendingFollow = useCallback(() => {
    const request = pendingFollowRef.current;
    if (request?.frame != null) cancelAnimationFrame(request.frame);
    pendingFollowRef.current = null;
  }, []);

  const followMeasuredBottom = useCallback(() => {
    if (pausedRef.current || !isFollowingBottomRef.current) return true;
    const list = listRef.current;
    if (!list) return false;
    const contentHeight =
      list.getFirstItemOffset() + list.getChildContainerDimensions().height
      + contentPaddingBottom;
    // FlashList 提交的是 cell 布局，原生 ScrollView 的内容范围可能尚未扩高。
    // 此时滚动会被截在旧底部；请求保留到原生尺寸事件到达，不另加 timer 或重试。
    // 两次测量独立取整，按物理像素允许一像素误差，不能按整数 dp 判断是否就绪。
    if (nativeContentHeightRef.current === null
      || PixelRatio.getPixelSizeForLayoutSize(contentHeight)
        - PixelRatio.getPixelSizeForLayoutSize(nativeContentHeightRef.current) > 1) return false;
    const offset = Math.max(0, contentHeight - list.getWindowSize().height);
    // 使用已提交的布局同步滚动；scrollToEnd 内部会再排 timer，导致尾栏先下移、下一帧才拉回。
    if (offset !== list.getAbsoluteLastScrollOffset()) {
      list.scrollToOffset({ offset, animated: false });
    }
    return true;
  }, [listRef, contentPaddingBottom]);

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
      if (followMeasuredBottom()) pendingFollowRef.current = null;
    });
  }, [cancelPendingFollow, followMeasuredBottom]);

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

  useEffect(() => {
    nativeContentHeightRef.current = null;
  }, [sessionId]);

  const handleContentSizeChange = useCallback((height: number) => {
    nativeContentHeightRef.current = height;
    if (pendingFollowRef.current) requestBottomFollow();
  }, [requestBottomFollow]);

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
        if (isTouchActiveRef.current || isUserDraggingRef.current) {
          requestBottomFollow();
        } else {
          // 原生范围已就绪时同批跟随，否则保留请求，等内容尺寸事件完成交接。
          cancelPendingFollow();
          pendingFollowRef.current = { frame: null };
          if (followMeasuredBottom()) pendingFollowRef.current = null;
        }
      }
    } else if (mutation.type === 'append' && mutation.appendedMessages.some(isNewMessagePromptEligible)) {
      setShowNewMessagePrompt(true);
    }
    previousSnapshotRef.current = { keys: renderedKeys };
    committedTimelineRef.current = timelineMessages;
  }, [renderedData, renderedKeys, timelineMessages, requestBottomFollow, cancelPendingFollow, followMeasuredBottom]);

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
    handleContentSizeChange,
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
