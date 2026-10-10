/** 将 Runtime 的模型增量投影为可节流更新的 Chat 草稿，并在 turn 结束时完成同一条消息。 */
import type { ModelTurnResult } from '@platform/ai';
import { buildAssistantMessagePreviewText } from '@features/chat/messages/domain';
import type { ChatMessage } from '../../messages/domain/ChatMessage';
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { buildMessageMetadata } from '../application/ChatReplyMetadata';
import { assertChatReplyNotAborted } from '../application/ChatReplyAbort';
import type { AssistantTurnCommitPort } from '../application/AssistantTurnCommit';
import { deliverCommittedAssistantSegment } from '../application/CommittedAssistantSegmentDelivery';
import { buildLogicalMessageId, formatMessageTime } from '../application/ChatReplyUtils';
import { emitChatMessagesPatched } from '../../messages/events/ChatEvents';
import { persistChatMessage, syncChatSessionPreview } from '../../messages/application/MessagePersistence';
import type {
  AIReplyConfig,
  AIReplyRuntimeContext,
  ProcessAIReplyCallbacks,
} from '../application/ChatReplyTypes';
import type { AIReplyPolicy } from '../application/ReplyPolicy';
import type { ChatAgentModelTurn } from './ChatAgentModelGateway';

const STREAMING_TOOL_PATCH_INTERVAL_MS = 80;
const STREAMING_TOOL_PATCH_MIN_CHARS = 24;

interface StreamingTurnState {
  readonly stepIndex: number;
  readonly replyStepId: string;
  readonly logicalMessageId: string;
  readonly createdAt: string;
  readonly time: string;
  reasoningText: string;
  answerText: string;
  hasAnswerInput: boolean;
  flushedReasoningText: string;
  flushedAnswerText: string;
  lastReasoningFlushAt: number;
  lastAnswerFlushAt: number;
  reasoningMessage: ChatMessage | null;
  assistantMessage: ChatMessage | null;
  reasoningFinalized: boolean;
  assistantFinalized: boolean;
  finalized: boolean;
}

export class ChatStreamingReplyProjector {
  private readonly turns = new Map<number, StreamingTurnState>();

  constructor(private readonly params: {
    sessionId: string;
    repository: IMessageRepository;
    callbacks: ProcessAIReplyCallbacks;
    aiConfig: AIReplyConfig;
    runtimeContext: AIReplyRuntimeContext;
    policy: Pick<AIReplyPolicy, 'bubbleDeliveryMode'>;
    /**
     * 最终落库策略。Legacy（persistsIntermediates=true）保持现状：流式草稿与
     * 中间 turn 直接落库并逐次 patch；canonical（false）中间一律不落库，
     * delta 只在内存累积，assistant 文本只经 T3 单事务最终落库。
     */
    persistence: AssistantTurnCommitPort;
    replyRunId: string;
  }) {}

  startTurn(stepIndex: number): void {
    if (this.turns.has(stepIndex)) {
      throw new Error(`Chat streaming turn ${stepIndex} started more than once`);
    }
    const now = new Date();
    const replyStepId = buildLogicalMessageId();
    this.turns.set(stepIndex, {
      stepIndex,
      replyStepId,
      logicalMessageId: replyStepId,
      createdAt: now.toISOString(),
      time: formatMessageTime(now),
      reasoningText: '',
      answerText: '',
      hasAnswerInput: false,
      flushedReasoningText: '',
      flushedAnswerText: '',
      lastReasoningFlushAt: 0,
      lastAnswerFlushAt: 0,
      reasoningMessage: null,
      assistantMessage: null,
      reasoningFinalized: false,
      assistantFinalized: false,
      finalized: false,
    });
  }

  async handleDelta(
    stepIndex: number,
    delta: { type: 'reasoning_delta' | 'assistant_text_delta'; text: string }
  ): Promise<void> {
    const state = this.requireTurn(stepIndex);
    this.assertActive();
    if (delta.type === 'reasoning_delta') {
      await this.appendReasoningText(state, delta.text);
      return;
    }
    await this.appendAnswerText(state, delta.text);
  }

  async completeModelTurn(stepIndex: number, turn: ChatAgentModelTurn): Promise<void> {
    const state = this.requireTurn(stepIndex);
    await this.reconcileModelPayload(state, turn);
    console.info('[ChatStreamTrace] model_turn_completed', {
      sessionId: this.params.sessionId,
      replyRunId: this.params.replyRunId,
      stepIndex,
      assistantTextLength: state.answerText.length,
      reasoningTextLength: state.reasoningText.length,
      toolCallCount: turn.toolCalls.length,
    });
    if (turn.toolCalls.length > 0) {
      await this.finalizeTurn(state, turn, false);
    }
  }

  async finalizeFinalTurn(stepIndex: number, turn: ChatAgentModelTurn): Promise<void> {
    const state = this.requireTurn(stepIndex);
    await this.reconcileModelPayload(state, turn);
    await this.finalizeTurn(state, turn, true);
  }

  async markFailed(): Promise<void> {
    const messageIds: number[] = [];
    for (const state of this.turns.values()) {
      if (state.reasoningMessage && !state.reasoningFinalized) {
        messageIds.push(state.reasoningMessage.id);
      }
      if (state.assistantMessage && !state.assistantFinalized) {
        messageIds.push(state.assistantMessage.id);
      }
    }
    if (messageIds.length === 0) {
      return;
    }
    for (const messageId of messageIds) {
      await this.params.repository.updateMessage(messageId, { status: 'failed' });
    }
    emitChatMessagesPatched({
      sessionId: this.params.sessionId,
      updatedMessageIds: messageIds,
    });
  }

  private async reconcileModelPayload(
    state: StreamingTurnState,
    turn: ModelTurnResult
  ): Promise<void> {
    if (turn.reasoningText !== state.reasoningText) {
      if (!turn.reasoningText.startsWith(state.reasoningText)) {
        throw new Error(`Chat streaming reasoning payload conflicts at step ${state.stepIndex}`);
      }
      await this.appendReasoningText(
        state,
        turn.reasoningText.slice(state.reasoningText.length)
      );
    }
    if (turn.assistantText !== state.answerText) {
      if (!turn.assistantText.startsWith(state.answerText)) {
        throw new Error(`Chat streaming assistant payload conflicts at step ${state.stepIndex}`);
      }
      await this.appendAnswerText(
        state,
        turn.assistantText.slice(state.answerText.length)
      );
    }
  }

  private async appendReasoningText(state: StreamingTurnState, text: string): Promise<void> {
    if (!text) {
      return;
    }
    state.reasoningText += text;
    await this.ensureReasoningMessage(state);
    await this.patchReasoningMessage(state);
  }

  private async appendAnswerText(state: StreamingTurnState, text: string): Promise<void> {
    if (!text) {
      return;
    }
    // 纯文本时代：流式 delta 即可见正文，直接透传累积。
    state.answerText += text;
    state.hasAnswerInput = true;
    if (state.answerText && !state.assistantMessage) {
      await this.ensureAssistantMessage(state);
    }
    await this.patchAssistantMessage(state);
  }

  private async finalizeTurn(
    state: StreamingTurnState,
    turn: ChatAgentModelTurn,
    emitFinalReply: boolean
  ): Promise<void> {
    if (state.finalized) {
      throw new Error(`Chat streaming turn ${state.stepIndex} finalized more than once`);
    }
    if (state.answerText && !state.assistantMessage) {
      await this.ensureAssistantMessage(state);
    }
    await this.patchReasoningMessage(state, true);
    await this.patchAssistantMessage(state, true);
    console.info('[ChatStreamTrace] turn_finalizing', {
      sessionId: this.params.sessionId,
      replyRunId: this.params.replyRunId,
      stepIndex: state.stepIndex,
      emitFinalReply,
      hasAnswerInput: state.hasAnswerInput,
      assistantTextLength: state.answerText.length,
      reasoningTextLength: state.reasoningText.length,
      reasoningMessageId: state.reasoningMessage?.id ?? null,
      assistantMessageId: state.assistantMessage?.id ?? null,
    });

    const updatedMessageIds: number[] = [];
    if (!this.params.persistence.persistsIntermediates) {
      // canonical：中间不落库，最终/前言统一经提交策略（T3 / 并入本轮 items）。
      await this.persistTurnViaCommitPort(state, turn, emitFinalReply);
      state.finalized = true;
      return;
    }
    if (state.reasoningMessage) {
      await this.finalizeReasoningMessage(state);
      updatedMessageIds.push(state.reasoningMessage.id);
    }
    if (state.assistantMessage && !state.assistantFinalized) {
      await this.params.repository.updateMessage(state.assistantMessage.id, {
        status: 'sent',
        apiMessageId: turn.messageId,
        tokensUsed: turn.usage.totalTokens,
        promptTokens: turn.usage.promptTokens,
        completionTokens: turn.usage.completionTokens,
        metadataJson: JSON.stringify(this.buildMetadata(state, 'reply', 'assistant', {})),
      });
      state.assistantFinalized = true;
      updatedMessageIds.push(state.assistantMessage.id);
      await syncChatSessionPreview({
        repository: this.params.repository,
        sessionId: this.params.sessionId,
        time: state.createdAt,
        previewText: buildAssistantMessagePreviewText(state.answerText),
      });
      await this.emitAssistantSegment(state);
      if (emitFinalReply) {
        this.params.callbacks.onReplyCommitted?.();
      }
    }
    if (updatedMessageIds.length > 0) {
      emitChatMessagesPatched({
        sessionId: this.params.sessionId,
        updatedMessageIds,
      });
    }
    state.finalized = true;
    if (!emitFinalReply) {
      return;
    }
    const finalText = state.answerText || state.reasoningText;
    const finalMessage = state.assistantMessage || state.reasoningMessage;
    if (finalMessage) {
      this.params.callbacks.onFinalReply?.({
        status: 'completed',
        sessionId: this.params.sessionId,
        correlationId: this.params.runtimeContext.correlationId || this.params.runtimeContext.replyRunId,
        text: finalText,
        previewText: finalText.trim(),
        joinedText: finalText.trim(),
        logicalMessageId: state.logicalMessageId,
        firstSegmentMessageId: finalMessage.id,
        lastSegmentMessageId: finalMessage.id,
        segmentTotal: 1,
        segments: [{
          messageId: finalMessage.id,
          segmentIndex: 0,
          text: finalText,
        }],
      });
    }
  }

  /**
   * canonical 路径：一个模型 turn 的最终文本只经提交策略处理。
   * - 最终 turn（emitFinalReply=true）：T3 单事务落库，回调由策略在 commit 后触发；
   * - 工具续轮的中间 turn：并入本轮 items，不单独落库。
   */
  private async persistTurnViaCommitPort(
    state: StreamingTurnState,
    turn: ChatAgentModelTurn,
    emitFinalReply: boolean
  ): Promise<void> {
    const response = {
      success: true,
      text: state.answerText,
      reasoningText: state.reasoningText || undefined,
      messageId: turn.messageId,
      totalTokens: turn.usage.totalTokens,
      promptTokens: turn.usage.promptTokens,
      completionTokens: turn.usage.completionTokens,
      isToolCall: turn.toolCalls.length > 0,
      toolCalls: turn.toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function' as const,
        function: {
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
      })),
    };
    const params = {
      sessionId: this.params.sessionId,
      response,
      repository: this.params.repository,
      callbacks: emitFinalReply
        ? this.params.callbacks
        : {
            ...this.params.callbacks,
            onFinalReply: undefined,
            onReplyCommitted: undefined,
          },
      aiConfig: this.params.aiConfig,
      runtimeContext: this.params.runtimeContext,
      policy: this.params.policy,
    };
    if (emitFinalReply) {
      await this.params.persistence.persistCompletedAssistantReply(params);
      return;
    }
    await this.params.persistence.persistAssistantPrelude(params);
  }

  private async ensureReasoningMessage(state: StreamingTurnState): Promise<void> {
    if (!this.params.persistence.persistsIntermediates) {
      // canonical：流式中间产物不落库，仅在内存累积。
      return;
    }
    if (state.reasoningMessage) {
      return;
    }
    state.reasoningMessage = await persistChatMessage({
      repository: this.params.repository,
      message: {
        sessionId: this.params.sessionId,
        text: state.reasoningText,
        isMe: false,
        senderType: 'reasoning',
        agentId: this.params.aiConfig.agentId ?? null,
        apiMessageId: null,
        time: state.time,
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
        replyToId: null,
        replyToText: null,
        status: 'streaming',
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        metadataJson: JSON.stringify(this.buildMetadata(state, 'reasoning', 'reasoning', {})),
        logicalMessageId: state.logicalMessageId,
      },
      previewText: null,
      notifyUI: this.params.callbacks.notifyUI,
    });
    console.info('[ChatStreamTrace] reasoning_persisted', {
      sessionId: this.params.sessionId,
      replyRunId: this.params.replyRunId,
      stepIndex: state.stepIndex,
      messageId: state.reasoningMessage.id,
      textLength: state.reasoningText.length,
    });
    state.flushedReasoningText = state.reasoningText;
    state.lastReasoningFlushAt = Date.now();
  }

  private async ensureAssistantMessage(state: StreamingTurnState): Promise<void> {
    if (!this.params.persistence.persistsIntermediates) {
      // canonical：流式中间产物不落库，仅在内存累积。
      return;
    }
    if (state.assistantMessage) {
      return;
    }
    state.assistantMessage = await persistChatMessage({
      repository: this.params.repository,
      message: {
        sessionId: this.params.sessionId,
        text: state.answerText,
        isMe: false,
        senderType: 'assistant',
        agentId: this.params.aiConfig.agentId ?? null,
        apiMessageId: null,
        time: state.time,
        createdAt: state.createdAt,
        updatedAt: state.createdAt,
        replyToId: null,
        replyToText: null,
        status: 'streaming',
        tokensUsed: 0,
        promptTokens: 0,
        completionTokens: 0,
        metadataJson: JSON.stringify(this.buildMetadata(state, 'reply', 'assistant', {})),
        logicalMessageId: state.logicalMessageId,
        segmentIndex: 0,
        segmentTotal: 1,
      },
      previewText: buildAssistantMessagePreviewText(state.answerText),
      notifyUI: this.params.callbacks.notifyUI,
    });
    console.info('[ChatStreamTrace] assistant_persisted', {
      sessionId: this.params.sessionId,
      replyRunId: this.params.replyRunId,
      stepIndex: state.stepIndex,
      messageId: state.assistantMessage.id,
      visibleTextLength: state.answerText.length,
    });
    state.flushedAnswerText = state.answerText;
    state.lastAnswerFlushAt = Date.now();
  }

  private async patchReasoningMessage(state: StreamingTurnState, force = false): Promise<void> {
    if (!state.reasoningMessage || !this.shouldFlush(
      state.reasoningText,
      state.flushedReasoningText,
      state.lastReasoningFlushAt,
      force
    )) {
      return;
    }
    await this.params.repository.updateMessage(state.reasoningMessage.id, {
      text: state.reasoningText,
      status: state.reasoningFinalized ? 'sent' : 'streaming',
    });
    state.flushedReasoningText = state.reasoningText;
    state.lastReasoningFlushAt = Date.now();
    emitChatMessagesPatched({
      sessionId: this.params.sessionId,
      updatedMessageIds: [state.reasoningMessage.id],
    });
  }

  private async patchAssistantMessage(state: StreamingTurnState, force = false): Promise<void> {
    if (!state.assistantMessage || !this.shouldFlush(
      state.answerText,
      state.flushedAnswerText,
      state.lastAnswerFlushAt,
      force
    )) {
      return;
    }
    await this.params.repository.updateMessage(state.assistantMessage.id, {
      text: state.answerText,
      status: state.assistantFinalized ? 'sent' : 'streaming',
    });
    await syncChatSessionPreview({
      repository: this.params.repository,
      sessionId: this.params.sessionId,
      time: state.createdAt,
      previewText: buildAssistantMessagePreviewText(state.answerText),
    });
    state.flushedAnswerText = state.answerText;
    state.lastAnswerFlushAt = Date.now();
    emitChatMessagesPatched({
      sessionId: this.params.sessionId,
      updatedMessageIds: [state.assistantMessage.id],
    });
  }

  private async finalizeReasoningMessage(state: StreamingTurnState): Promise<void> {
    if (!state.reasoningMessage || state.reasoningFinalized) {
      return;
    }
    await this.patchReasoningMessage(state, true);
    await this.params.repository.updateMessage(state.reasoningMessage.id, { status: 'sent' });
    state.reasoningFinalized = true;
    emitChatMessagesPatched({
      sessionId: this.params.sessionId,
      updatedMessageIds: [state.reasoningMessage.id],
    });
  }

  private async emitAssistantSegment(state: StreamingTurnState): Promise<void> {
    if (!state.assistantMessage) {
      return;
    }
    await deliverCommittedAssistantSegment({
      sessionId: this.params.sessionId,
      text: state.answerText,
      metadataJson: state.assistantMessage.metadataJson,
      messageId: state.assistantMessage.id,
      logicalMessageId: state.logicalMessageId,
      segmentIndex: 0,
      segmentTotal: 1,
      aiConfig: this.params.aiConfig,
      runtimeContext: this.params.runtimeContext,
      callbacks: this.params.callbacks,
    });
  }

  private buildMetadata(
    state: StreamingTurnState,
    kind: 'reasoning' | 'reply',
    phase: 'reasoning' | 'assistant',
    extra: Record<string, unknown>
  ): Record<string, unknown> {
    return buildMessageMetadata(this.params.aiConfig, this.params.runtimeContext, {
      kind,
      replyRunId: this.params.replyRunId,
      replyStepId: state.replyStepId,
      stepIndex: state.stepIndex,
      phase,
      ...extra,
    });
  }

  private shouldFlush(
    nextText: string,
    flushedText: string,
    lastFlushAt: number,
    force = false
  ): boolean {
    if (nextText === flushedText && !force) {
      return false;
    }
    if (force) {
      return nextText !== flushedText;
    }
    return Date.now() - lastFlushAt >= STREAMING_TOOL_PATCH_INTERVAL_MS
      || Math.abs(nextText.length - flushedText.length) >= STREAMING_TOOL_PATCH_MIN_CHARS;
  }

  private assertActive(): void {
    assertChatReplyNotAborted(this.params.runtimeContext);
  }

  private requireTurn(stepIndex: number): StreamingTurnState {
    const state = this.turns.get(stepIndex);
    if (!state) {
      throw new Error(`Chat streaming event references unknown step ${stepIndex}`);
    }
    return state;
  }
}
