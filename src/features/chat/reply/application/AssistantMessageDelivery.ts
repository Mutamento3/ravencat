/** 负责将助手回复按分段持久化并按节奏或立即投递，并维护投递完成状态。 */
import { buildAssistantMessagePreviewText } from '@features/chat/messages/domain';
import type { ChatMessage, CreateMessageInput } from '../../messages/domain/ChatMessage';
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { persistChatMessage } from '../../messages/application/MessagePersistence';

const INITIAL_SEGMENT_DELIVERY_DELAY_MS = 120;
const MIN_SEGMENT_DELIVERY_DELAY_MS = 1000;
const MAX_SEGMENT_DELIVERY_DELAY_MS = 2000;
const SEGMENT_DELIVERY_CHAR_FACTOR_MS = 35;

interface PendingAssistantDeliveryState {
  sessionId: string;
  deliveryKey: string;
  logicalMessageId: string | null;
  segmentTotal: number;
  deliveredSegments: AssistantDeliveredSegmentSnapshot[];
  timerId: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  repository: IMessageRepository;
  notifyUI?: (sessionId: string) => void;
  lastDeliveredMessageId: number | null;
  tokensUsed: number;
  promptTokens: number;
  completionTokens: number;
  completionResolved: boolean;
  firstMessage: ChatMessage | null;
  firstMessageResolved: boolean;
  resolveFirstMessage: (message: ChatMessage | null) => void;
  resolveCompletion: (payload: AssistantDeliveryCompletionResult) => void;
}

export interface AssistantMessageSegmentDeliveredPayload {
  logicalMessageId: string | null;
  segmentIndex: number;
  segmentTotal: number;
  text: string;
  message: ChatMessage;
}

export interface AssistantDeliveredSegmentSnapshot {
  messageId: number;
  segmentIndex: number;
  text: string;
}

export interface DeliverAssistantMessageParams {
  repository: IMessageRepository;
  message: CreateMessageInput;
  segments?: string[];
  notifyUI?: (sessionId: string) => void;
  shouldContinue?: () => boolean;
  onSegmentDelivered?: (
    payload: AssistantMessageSegmentDeliveredPayload
  ) => void | Promise<void>;
  logicalMessageId?: string | null;
  deliveryTiming?: 'paced' | 'immediate';
}

export interface AssistantDeliveryCompletionResult {
  completed: boolean;
  logicalMessageId: string | null;
  lastDeliveredMessageId: number | null;
  firstSegmentMessageId: number | null;
  lastSegmentMessageId: number | null;
  segmentTotal: number;
  segments: AssistantDeliveredSegmentSnapshot[];
  joinedText: string;
}

export interface DeliverAssistantMessageResult {
  firstMessage: ChatMessage | null;
  logicalMessageId: string | null;
  segmentTotal: number;
  completion: Promise<AssistantDeliveryCompletionResult>;
}

const pendingAssistantDeliveries = new Map<string, Map<string, PendingAssistantDeliveryState>>();

function formatMessageTime(date: Date | string): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  const hours = value.getHours().toString().padStart(2, '0');
  const minutes = value.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

function buildLogicalMessageId(): string {
  return `lm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildPendingDeliveryKey(): string {
  return `delivery_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function computeSegmentDeliveryDelay(segmentText: string): number {
  const trimmed = String(segmentText || '').trim();
  if (!trimmed) {
    return MIN_SEGMENT_DELIVERY_DELAY_MS;
  }

  const estimatedDelay = trimmed.length * SEGMENT_DELIVERY_CHAR_FACTOR_MS;
  return Math.max(
    MIN_SEGMENT_DELIVERY_DELAY_MS,
    Math.min(MAX_SEGMENT_DELIVERY_DELAY_MS, estimatedDelay)
  );
}

function getSegmentDeliveryDelay(segmentIndex: number, segmentText: string): number {
  if (segmentIndex === 0) {
    return INITIAL_SEGMENT_DELIVERY_DELAY_MS;
  }

  return computeSegmentDeliveryDelay(segmentText);
}

function getOrCreateSessionDeliveryMap(sessionId: string): Map<string, PendingAssistantDeliveryState> {
  const existingMap = pendingAssistantDeliveries.get(sessionId);
  if (existingMap) {
    return existingMap;
  }

  const nextMap = new Map<string, PendingAssistantDeliveryState>();
  pendingAssistantDeliveries.set(sessionId, nextMap);
  return nextMap;
}

function cleanupPendingDelivery(sessionId: string, deliveryKey: string): void {
  const sessionDeliveries = pendingAssistantDeliveries.get(sessionId);
  if (!sessionDeliveries) {
    return;
  }

  const state = sessionDeliveries.get(deliveryKey);
  if (state?.timerId) {
    clearTimeout(state.timerId);
  }

  sessionDeliveries.delete(deliveryKey);

  if (sessionDeliveries.size === 0) {
    pendingAssistantDeliveries.delete(sessionId);
  }
}

async function notifySegmentDelivered(
  callback: DeliverAssistantMessageParams['onSegmentDelivered'],
  payload: AssistantMessageSegmentDeliveredPayload
): Promise<void> {
  if (!callback) {
    return;
  }

  try {
    await Promise.resolve(callback(payload));
  } catch (error) {
    console.error('[AssistantMessageDelivery] Failed to notify delivered segment:', error);
  }
}

function resolveDeliveryCompletion(
  state: PendingAssistantDeliveryState,
  completed: boolean
): void {
  if (state.completionResolved) {
    return;
  }

  state.completionResolved = true;
  const segments = state.deliveredSegments
    .slice()
    .sort((left, right) => left.segmentIndex - right.segmentIndex);

  state.resolveCompletion({
    completed,
    logicalMessageId: state.logicalMessageId,
    lastDeliveredMessageId: state.lastDeliveredMessageId,
    firstSegmentMessageId: segments[0]?.messageId ?? null,
    lastSegmentMessageId: segments[segments.length - 1]?.messageId ?? null,
    segmentTotal: state.segmentTotal,
    segments,
    joinedText: segments
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join('\n\n'),
  });
}

function resolveFirstDeliveredMessage(
  state: PendingAssistantDeliveryState,
  message: ChatMessage | null
): void {
  if (state.firstMessageResolved) {
    return;
  }

  state.firstMessageResolved = true;
  state.firstMessage = message;
  state.resolveFirstMessage(message);
}

function shouldContinueDelivery(
  predicate?: DeliverAssistantMessageParams['shouldContinue']
): boolean {
  if (!predicate) {
    return true;
  }

  try {
    return predicate() !== false;
  } catch (error) {
    console.warn('[AssistantMessageDelivery] Delivery continuation predicate failed:', error);
    return false;
  }
}

async function persistAssistantSegment(params: {
  repository: IMessageRepository;
  baseMessage: CreateMessageInput;
  segmentText: string;
  segmentIndex: number;
  segmentTotal: number;
  logicalMessageId: string | null;
  notifyUI?: (sessionId: string) => void;
}): Promise<ChatMessage> {
  const {
    repository,
    baseMessage,
    segmentText,
    segmentIndex,
    segmentTotal,
    logicalMessageId,
    notifyUI,
  } = params;

  const isFirstSegment = segmentIndex === 0;
  const isFinalSegment = segmentIndex === segmentTotal - 1;
  const committedAt = new Date();
  const createdAt = committedAt.toISOString();
  const time = formatMessageTime(committedAt);

  return persistChatMessage({
    repository,
    message: {
      ...baseMessage,
      text: segmentText,
      time,
      createdAt,
      updatedAt: createdAt,
      replyToId: isFirstSegment ? baseMessage.replyToId ?? null : null,
      replyToText: isFirstSegment ? baseMessage.replyToText ?? null : null,
      metadataJson: baseMessage.metadataJson ?? null,
      logicalMessageId,
      segmentIndex,
      segmentTotal,
      deliveryStatus: 'delivered',
      tokensUsed: isFinalSegment ? baseMessage.tokensUsed || 0 : 0,
      promptTokens: isFinalSegment ? baseMessage.promptTokens || 0 : 0,
      completionTokens: isFinalSegment ? baseMessage.completionTokens || 0 : 0,
    },
    previewText: buildAssistantMessagePreviewText(segmentText),
    notifyUI,
  });
}

function scheduleSegmentDelivery(
  state: PendingAssistantDeliveryState,
  segments: string[],
  segmentIndex: number,
  params: DeliverAssistantMessageParams
): void {
  if (state.cancelled || !shouldContinueDelivery(params.shouldContinue)) {
    resolveFirstDeliveredMessage(state, null);
    resolveDeliveryCompletion(state, false);
    cleanupPendingDelivery(state.sessionId, state.deliveryKey);
    return;
  }

  if (segmentIndex >= segments.length) {
    resolveDeliveryCompletion(state, true);
    cleanupPendingDelivery(state.sessionId, state.deliveryKey);
    return;
  }

  const nextText = segments[segmentIndex];
  const deliverSegment = async () => {
    state.timerId = null;

    if (state.cancelled || !shouldContinueDelivery(params.shouldContinue)) {
      resolveFirstDeliveredMessage(state, null);
      resolveDeliveryCompletion(state, false);
      cleanupPendingDelivery(state.sessionId, state.deliveryKey);
      return;
    }

    try {
      const insertedMessage = await persistAssistantSegment({
        repository: params.repository,
        baseMessage: params.message,
        segmentText: nextText,
        segmentIndex,
        segmentTotal: segments.length,
        logicalMessageId: state.logicalMessageId,
        notifyUI: params.notifyUI,
      });

      state.lastDeliveredMessageId = insertedMessage.id;
      state.deliveredSegments.push({
        messageId: insertedMessage.id,
        segmentIndex,
        text: insertedMessage.text,
      });
      if (segmentIndex === 0) {
        resolveFirstDeliveredMessage(state, insertedMessage);
      }

      if (state.cancelled || !shouldContinueDelivery(params.shouldContinue)) {
        resolveDeliveryCompletion(state, false);
        cleanupPendingDelivery(state.sessionId, state.deliveryKey);
        return;
      }

      await notifySegmentDelivered(params.onSegmentDelivered, {
        logicalMessageId: state.logicalMessageId,
        segmentIndex,
        segmentTotal: segments.length,
        text: insertedMessage.text,
        message: insertedMessage,
      });
    } catch (error) {
      resolveFirstDeliveredMessage(state, null);
      console.error('[AssistantMessageDelivery] Failed to persist assistant segment:', error);
      resolveDeliveryCompletion(state, false);
      cleanupPendingDelivery(state.sessionId, state.deliveryKey);
      return;
    }

    scheduleSegmentDelivery(state, segments, segmentIndex + 1, params);
  };

  if (params.deliveryTiming === 'immediate') {
    // Android 后台会冻结 React Native 的 setTimeout。悬浮层若复用 paced 投递，
    // AI 已经完成网络响应后仍会永远卡在 pending，直到用户重新打开 Activity。
    // 这里直接续接 Promise 链，保证落库、事件和原生悬浮预览都能在后台完成。
    void deliverSegment();
    return;
  }

  const delayMs = getSegmentDeliveryDelay(segmentIndex, nextText);
  state.timerId = setTimeout(() => {
    void deliverSegment();
  }, delayMs);
}

export async function deliverAssistantMessage(
  params: DeliverAssistantMessageParams
): Promise<DeliverAssistantMessageResult> {
  const { message } = params;
  const hasProvidedSegments = Array.isArray(params.segments);
  const rawSegments = hasProvidedSegments
    ? (params.segments || [])
    : [message.text];

  const segments = rawSegments
    .map((segment) => segment.trim())
    .filter(Boolean);

  const fallbackText = String(message.text || '').trim();
  const normalizedSegments = segments.length > 0 ? segments : [fallbackText];
  const totalSegments = normalizedSegments.length;
  const logicalMessageId = params.logicalMessageId ?? (totalSegments > 1 ? buildLogicalMessageId() : null);

  let resolveFirstMessageFn!: (message: ChatMessage | null) => void;
  const firstMessagePromise = new Promise<ChatMessage | null>((resolve) => {
    resolveFirstMessageFn = resolve;
  });

  let resolveCompletionFn!: (payload: AssistantDeliveryCompletionResult) => void;
  const completion = new Promise<AssistantDeliveryCompletionResult>((resolve) => {
    resolveCompletionFn = resolve;
  });

  if (!shouldContinueDelivery(params.shouldContinue)) {
    resolveFirstMessageFn(null);
    resolveCompletionFn({
      completed: false,
      logicalMessageId,
      lastDeliveredMessageId: null,
      firstSegmentMessageId: null,
      lastSegmentMessageId: null,
      segmentTotal: totalSegments,
      segments: [],
      joinedText: '',
    });

    return {
      firstMessage: await firstMessagePromise,
      logicalMessageId,
      segmentTotal: totalSegments,
      completion,
    };
  }

  const sessionDeliveries = getOrCreateSessionDeliveryMap(message.sessionId);
  const state: PendingAssistantDeliveryState = {
    sessionId: message.sessionId,
    deliveryKey: logicalMessageId || buildPendingDeliveryKey(),
    logicalMessageId,
    segmentTotal: totalSegments,
    deliveredSegments: [],
    timerId: null,
    cancelled: false,
    repository: params.repository,
    notifyUI: params.notifyUI,
    lastDeliveredMessageId: null,
    tokensUsed: message.tokensUsed || 0,
    promptTokens: message.promptTokens || 0,
    completionTokens: message.completionTokens || 0,
    completionResolved: false,
    firstMessage: null,
    firstMessageResolved: false,
    resolveFirstMessage: resolveFirstMessageFn,
    resolveCompletion: resolveCompletionFn,
  };
  sessionDeliveries.set(state.deliveryKey, state);

  scheduleSegmentDelivery(state, normalizedSegments, 0, params);

  const firstMessage = await firstMessagePromise;

  return {
    firstMessage,
    logicalMessageId,
    segmentTotal: totalSegments,
    completion,
  };
}
