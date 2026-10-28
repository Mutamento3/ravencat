/** 协调单聊详情页的消息历史、实时同步、发送流程与通话阻断状态。 */

import { useMemo, useState, useSyncExternalStore } from 'react';
import {
  buildAIRequestConfig,
  type ChatDetailAIAssistantLike,
} from '../components/chatTypes';
import { useMessageHistoryState } from '../components/useMessageHistoryState';
import { useChatTimelineSync } from '../components/useChatTimelineSync';
import { useChatSendFlow } from './useChatSendFlow';
import {
  getActiveChatCall,
  subscribeActiveChatCall,
  isChatSendBlockedByCall,
  type ChatCallSession,
} from '../../../conversation/application/ChatCallGateway';
import { getChatInteractionProfile, useTheme } from '@shared/theme';

/**
 * 聊天详情页核心逻辑 Hook
 *
 * 整合消息历史管理、实时同步与消息发送三大模块，为聊天页面提供统一的状态与操作方法。
 * 该 Hook 负责：
 * - 从后端获取会话消息列表，支持分页加载历史消息
 * - 通过 WebSocket 等实时通道监听新消息并更新列表
 * - 处理用户发送消息及发送失败重试
 * - 管理 AI 助手配置与“正在输入”状态
 *
 * @param sessionId - 当前会话的唯一标识符，传入 `null` 或 `undefined` 时表示没有活动会话
 * @param aiAssistant - AI 助手配置对象，包含头像、名称、请求端点等信息，可为 `null`
 * @returns 聊天详情页所需的所有状态和方法
 */
export function useChatDetail(
  sessionId?: string | null,
  aiAssistant?: ChatDetailAIAssistantLike | null,
  onCallCreated?: (call: ChatCallSession) => void,
) {
  const theme = useTheme();
  const interactionProfile = getChatInteractionProfile(theme);
  // 对方是否正在输入的状态（由实时同步模块更新）
  const [isTyping, setIsTyping] = useState(false);
  const activeCall = useSyncExternalStore(subscribeActiveChatCall, getActiveChatCall);

  // 根据 AI 助手配置生成请求参数（如 API 端点、认证头等）
  const aiRequestConfig = useMemo(() => {
    const baseConfig = buildAIRequestConfig(aiAssistant);
    if (!baseConfig) return null;

    return {
      ...baseConfig,
      allowMultipleBubbles: interactionProfile.enableAssistantMessageSegmentation
        ? baseConfig.allowMultipleBubbles : false,
      enableStreamingReply: baseConfig.enableStreamingReply ?? interactionProfile.preferStreamingReply,
    };
  }, [
    aiAssistant,
    interactionProfile.enableAssistantMessageSegmentation,
    interactionProfile.preferStreamingReply,
  ]);
  const aiRequestConfigId = aiRequestConfig?.id;

  const isChatSendBlockedByActiveCall = isChatSendBlockedByCall(activeCall, sessionId, aiRequestConfigId);

  // 消息历史状态管理：消息列表、加载状态、分页加载、刷新等
  const {
    messages,
    setMessages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    setError,
    loadMore,
    refresh,
    resetHistory,
    lastMessageIdRef,
  } = useMessageHistoryState(sessionId);

  // 实时同步：监听新消息，更新消息列表和输入状态
  useChatTimelineSync({
    sessionId,
    messages,
    isTyping,
    setIsTyping,
    setMessages,
    lastMessageIdRef,
    resetHistory,
  });

  // 消息发送流程：发送新消息、重试失败消息
  const {
    sendMessage,
    sendSticker,
    voiceRecordingState,
    voiceRecordingProgress,
    voiceRecordingError,
    voiceReviewDraft,
    prepareVoiceRecordingEntry,
    dismissVoiceRecordingError,
    startVoiceRecording,
    finishVoiceRecording,
    updateVoiceReviewTranscript,
    commitVoiceReviewDraft,
    discardVoiceReviewDraft,
    cancelVoiceRecording,
    startVideoCall,
    retrySend,
    inviteTogetherListening,
    acceptTogetherListening,
    declineTogetherListening,
    leaveTogetherListening,
  } = useChatSendFlow({
    sessionId,
    aiAssistant,
    aiRequestConfig,
    messages,
    setMessages,
    setError,
    setIsTyping,
    lastMessageIdRef,
    onCallCreated,
  });

  return {
    messages,          // 当前会话的消息列表
    setMessages,       // 直接更新消息列表（用于删除等本地操作）
    isLoading,         // 是否正在加载初始消息
    isLoadingMore,     // 是否正在加载更多历史消息
    hasMore,           // 是否还有更多历史消息可加载
    error,             // 错误信息（网络错误、发送失败等）
    isTyping,          // 对方是否正在输入
    isChatSendBlockedByActiveCall,
    sendMessage,       // 发送新消息 (text: string, replyToId?: number) => void
    sendSticker,       // 发送独立 Sticker 消息
    voiceRecordingState,
    voiceRecordingProgress,
    voiceRecordingError,
    voiceReviewDraft,
    prepareVoiceRecordingEntry,
    dismissVoiceRecordingError,
    startVoiceRecording,
    finishVoiceRecording,
    updateVoiceReviewTranscript,
    commitVoiceReviewDraft,
    discardVoiceReviewDraft,
    cancelVoiceRecording,
    startVideoCall,    // 从聊天工具面板发起视频电话
    inviteTogetherListening,
    acceptTogetherListening,
    declineTogetherListening,
    leaveTogetherListening,
    loadMore,          // 加载更多历史消息
    refresh,           // 刷新消息列表（重新拉取最新数据）
    retrySend,         // 重试发送失败的消息 (messageId: number) => void
  };
}
