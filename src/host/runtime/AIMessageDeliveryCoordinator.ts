/**
 * @fileoverview AIMessageDeliveryCoordinator —— AI 消息落库后的统一交付策略。
 *
 * Protected Contract:
 * 修改本文件或相关 delivery wiring 前必须阅读：
 * docs/architecture/ai-message-delivery-invariant.md
 * 
 * 唯一负责「assistant message committed 之后怎么办」的判定：
 * 
 * - 当前会话正在前台真实呈现 → 抑制系统通知（已读标记由 Host UI 随未读刷新同序完成）；
 * - 其余情况（App 后台 / 前台其它页面）→ Native NotificationManager 聚合通知，
 *   通知点击导航由既有 notification response 链承担；
 * - payload.userNotificationHandled（如 RavenCat overlay preview 已承载展示）→ 不再发系统通知。
 *
 * 该判定必须在 Headless execution host 的 runtime 中同样成立，
 * 因此不得放在 KimiPhoneHost 组件树里：前台事实来自 ChatForegroundContext 快照
 * （页面挂载时维护，headless fresh runtime 缺省 appActive=false，自然走通知分支），
 * App 前后台直接读 AppState。KimiPhoneHost 只保留已读标记、未读角标与列表刷新等 UI 关注。
 */
import { AppState } from 'react-native';
import { getAIAssistantById, getAssistantDisplayName } from '@features/assistants';
import {
  conversationKeyOfDirect,
  conversationKeyOfGroup,
  type AIMessageObserverPayload,
  type AIMessageReceivedPayload,
  type AIMessageDeliveryReceipt,
  notifyAIMessageObservers,
} from '@features/chat';
import {
  configureAIMessageDeliveryHandler,
  isChatConversationForeground,
  isGroupConversationForeground,
  configureAssistantMessageArrivalRuntime,
  applyAssistantMessageArrivalSnapshot,
} from '@features/chat/composition';
import {
  sendAIMessageNotification,
  addMessageArrivalListener,
  getMessageArrivalSnapshot,
  beginMessageArrival,
  awaitMessageArrival,
  finishMessageArrival,
} from '@platform/device';
import { logTurnTimeline } from '@shared/diagnostics/TurnTimelineLog';

/**
 * 该 AI 消息所属会话是否正在前台真实呈现（群聊按 groupId 匹配，成员 aiId 不参与）。
 * KimiPhoneHost 的 UI 刷新与本协调器的交付判定共用这一条事实，禁止各写一套。
 * 观察者通知可能缺少 AI 身份（如通话状态条目）：无 aiId 的单聊事实恒视为非前台。
 */
export function isAIMessageConversationForeground(payload: AIMessageObserverPayload): boolean {
  if (AppState.currentState !== 'active') {
    return false;
  }
  if (payload.conversationKind === 'group') {
    return Boolean(payload.groupId && isGroupConversationForeground(payload.groupId));
  }
  return Boolean(
    payload.aiId
    && payload.sessionId
    && isChatConversationForeground(payload.aiId, payload.sessionId)
  );
}

function buildNotificationEventId(payload: AIMessageReceivedPayload): string {
  if (payload.logicalMessageId) {
    return `${payload.logicalMessageId}:${payload.segmentIndex ?? 0}`;
  }
  return `message:${payload.committedMessageId}`;
}

async function resolveNotificationAssistantName(payload: AIMessageReceivedPayload): Promise<string> {
  const assistant = await getAIAssistantById(payload.aiId);
  return assistant ? getAssistantDisplayName(assistant) : payload.aiName;
}

async function deliverAIMessage(
  payload: AIMessageReceivedPayload
): Promise<AIMessageDeliveryReceipt> {
  const conversationKey = payload.conversationKind === 'group' && payload.groupId
    ? conversationKeyOfGroup(payload.groupId)
    : conversationKeyOfDirect(payload.aiId);
  // 先推进到达，再决定通知；权限拒绝、前台抑制和消费方展示均不改变到达节奏。
  if (!payload.arrivalAlreadyScheduled) {
    applyAssistantMessageArrivalSnapshot(await awaitMessageArrival(conversationKey, payload.committedMessageId));
  }
  if (isAIMessageConversationForeground(payload)) {
    logTurnTimeline('notification_suppressed', { sessionId: payload.sessionId });
    return {
      status: 'suppressed_foreground',
      errorCategory: null,
    };
  }

  if (payload.userNotificationHandled) {
    // RavenCat overlay preview 等消费者已承载展示，保留其精确 displayed receipt 语义。
    return {
      status: 'handled_by_consumer',
      errorCategory: null,
    };
  }

  // 聚合维度：群聊按 group:<groupId> + 群名，单聊按 ai:<aiId> + AI 名；发送者名用于群 InboxStyle 行。
  const isGroupConversation = payload.conversationKind === 'group' && Boolean(payload.groupId);
  const aiDisplayName = await resolveNotificationAssistantName(payload);
  const conversationTitle = isGroupConversation
    ? payload.groupName || aiDisplayName
    : aiDisplayName;

  const posted = await sendAIMessageNotification({
    turnRunId: payload.turnRunId,
    aiId: payload.aiId,
    aiName: aiDisplayName,
    message: payload.message,
    aiAvatar: payload.aiAvatar || null,
    sessionId: payload.sessionId,
    deliveryKind: payload.deliveryKind,
    triggerSource: payload.triggerSource,
    relatedEntityId: payload.relatedEntityId || null,
    notificationScope: payload.notificationScope || null,
    conversationKey,
    conversationTitle,
    conversationKind: isGroupConversation ? 'group' : 'direct',
    groupId: payload.groupId || null,
    senderName: payload.aiName,
    senderAvatar: payload.aiAvatar || null,
    // 优先使用逻辑分段；无逻辑分段时使用已提交消息 ID，禁止时间戳幂等键。
    eventId: buildNotificationEventId(payload),
  });
  if (posted) {
    logTurnTimeline('notification_enqueued', { sessionId: payload.sessionId });
    return {
      status: 'shown',
      errorCategory: null,
    };
  }
  logTurnTimeline('notification_failed', { sessionId: payload.sessionId });
  return {
    status: 'failed',
    errorCategory: 'native_notification_not_shown',
  };
}

let configured = false;

/** 每个 JS runtime（页面 / Headless execution host）各注册一次；幂等。 */
export function configureAIMessageDeliveryCoordinator(): void {
  if (configured) {
    return;
  }
  configured = true;
  configureAssistantMessageArrivalRuntime({
    begin: ({ observer, messageIds }) => beginMessageArrival(observer, messageIds),
    finish: finishMessageArrival,
  });
  addMessageArrivalListener(({ snapshot, observer }) => {
    applyAssistantMessageArrivalSnapshot(snapshot);
    notifyAIMessageObservers(observer);
  });
  void getMessageArrivalSnapshot().then(applyAssistantMessageArrivalSnapshot).catch((error) => {
    console.error('[AIMessageDeliveryCoordinator] 读取消息到达进度失败：', error);
  });
  configureAIMessageDeliveryHandler((payload) => deliverAIMessage(payload));
}
