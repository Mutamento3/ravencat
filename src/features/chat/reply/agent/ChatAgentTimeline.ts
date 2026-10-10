/**
 * Agent run 的短生命周期时间线。
 *
 * canonical user_reply 在 T3 之前不能把中间事实旁路写入 messages。这个小对象
 * 因此同时承担两件事：按 Runtime 事件首次可见的顺序分配 run-local sequence，
 * 以及在 run 成功时把内存时间线转换成 ConversationTurnCommitItem[]。
 *
 * Legacy（persistence.persistsIntermediates=true）不使用这里的提交转换，仍由
 * 原有流式草稿和工具状态 projector 负责逐条落库。
 */
import type { ModelToolCall } from '@platform/ai';
import type { AgentTerminalCode, AgentToolOutcome } from '@platform/agentRuntime';
import {
  isStickerSendIntent,
  type StickerMessageSnapshot,
} from '@features/stickers';
import type { ChatMessage, CreateMessageInput } from '../../messages/domain/ChatMessage';
import {
  buildAgentTimelineClientMessageId,
  buildAgentTimelineIdentity,
} from '../../messages/domain/AgentTimelineIdentity';
import type {
  AIReplyConfig,
  AIReplyRuntimeContext,
  AIResponse,
} from '../application/ChatReplyTypes';
import type { AIReplyPolicy } from '../application/ReplyPolicy';
import {
  buildChatToolStatusMessageMetadata,
  buildMessageMetadata,
} from '../application/ChatReplyMetadata';
import { normalizeAssistantResponseText } from '../application/AssistantReplyPersistence';
import { buildAssistantTurnItems } from '../application/AssistantTurnCommit';
import { formatMessageTime } from '../application/ChatReplyUtils';
import type { ConversationTurnCommitItem } from '../domain/ConversationTurn';
import type { ChatAgentModelTurn } from './ChatAgentModelGateway';
import {
  buildToolStatusText,
  joinToolDisplayNames,
  resolveToolCallDisplayName,
} from './ToolReplyPresentation';
import {
  isVoiceMessageSendIntent,
  type VoiceMessageSendIntent,
} from './SendVoiceMessageTool';
import { buildChatVoiceMessageMetadata } from '../../messages/domain/chatMessageMetadata';

export type FinalAssistantPolicy = 'commit_as_reply' | 'record_as_activity';

export type AgentTimelineItemKind = 'reasoning' | 'assistant' | 'tool';

export type AgentTimelineItemStatus =
  | 'streaming'
  | 'running'
  | 'sent'
  | 'completed'
  | 'failed';

/**
 * transient presentation 使用的稳定条目快照。
 * clientMessageId 是同一 run 内唯一的 replacement key；文本不是 identity。
 */
export interface AgentTimelineItemSnapshot {
  readonly runId: string;
  readonly sequence: number;
  readonly identity: string;
  readonly stepIndex: number;
  readonly kind: AgentTimelineItemKind;
  readonly status: AgentTimelineItemStatus;
  readonly text: string;
  readonly clientMessageId: string;
  readonly createdAt: string;
  readonly time: string;
  readonly apiMessageId?: string | null;
  readonly toolNames?: readonly string[];
  readonly toolDisplayNames?: readonly string[];
}

interface AgentTimelineItem extends AgentTimelineItemSnapshot {
  readonly toolCalls: readonly ModelToolCall[];
  readonly outcomes: ReadonlyMap<string, AgentToolOutcome>;
  turn: ChatAgentModelTurn | null;
}

interface TimelineStep {
  readonly stepIndex: number;
  turn: ChatAgentModelTurn | null;
  reasoningItem: AgentTimelineItem | null;
  assistantItem: AgentTimelineItem | null;
  toolItem: AgentTimelineItem | null;
  readonly stickerItems: StickerTimelineItem[];
  readonly voiceItems: VoiceTimelineItem[];
  readonly outcomes: Map<string, AgentToolOutcome>;
}

/** 工具返回的 Sticker intent 只在 T3 前暂存在内存，不投影为另一条 transient UI 路径。 */
interface StickerTimelineItem {
  readonly sequence: number;
  readonly stepIndex: number;
  readonly toolCallId: string;
  readonly sticker: StickerMessageSnapshot;
  readonly apiMessageId: string | null;
  readonly createdAt: string;
  readonly time: string;
}

interface VoiceTimelineItem {
  readonly sequence: number;
  readonly stepIndex: number;
  readonly toolCallId: string;
  readonly intent: VoiceMessageSendIntent;
  readonly apiMessageId: string | null;
  readonly createdAt: string;
  readonly time: string;
}

export interface AgentTimelineChangedEvent {
  readonly runId: string;
  readonly items: readonly AgentTimelineItemSnapshot[];
}

export interface AgentTimelineTransientSink {
  onChanged?: (event: AgentTimelineChangedEvent) => void;
  onCommitted?: (event: {
    runId: string;
    messages: readonly ChatMessage[];
    outcome: 'committed' | 'fence_failed' | 'empty_items';
  }) => void;
  onCleared?: (event: {
    runId: string;
    reason?: 'superseded' | 'cancelled' | 'fence_failed' | 'model_failure' | 'completed';
  }) => void;
}

export interface BuildAgentTimelineItemsParams {
  sessionId: string;
  aiConfig?: AIReplyConfig;
  runtimeContext?: AIReplyRuntimeContext;
  policy: Pick<AIReplyPolicy, 'bubbleDeliveryMode'>;
  finalAssistantPolicy: FinalAssistantPolicy;
  finalStepIndex: number;
}

export class ChatAgentTimeline {
  private readonly steps = new Map<number, TimelineStep>();
  private readonly items: AgentTimelineItem[] = [];
  private nextSequence = 1;

  constructor(
    private readonly runId: string,
    private readonly timelineHidden: (toolName: string) => boolean,
    private readonly sink: AgentTimelineTransientSink = {},
  ) {}

  /** model_turn_started 是所有 delta 的前置事件，先建立 step 所有权。 */
  startStep(stepIndex: number): void {
    if (this.steps.has(stepIndex)) {
      throw new Error(`Chat Agent step ${stepIndex} was projected more than once`);
    }
    this.steps.set(stepIndex, {
      stepIndex,
      turn: null,
      reasoningItem: null,
      assistantItem: null,
      toolItem: null,
      stickerItems: [],
      voiceItems: [],
      outcomes: new Map(),
    });
  }

  /** 完整 transport 没有 delta 时也从 model turn 建立同样的 reasoning → assistant 顺序。 */
  reconcileModelTurn(
    stepIndex: number,
    turn: ChatAgentModelTurn,
    includeAssistant = true,
  ): void {
    const step = this.requireStep(stepIndex);
    if (step.turn) {
      throw new Error(`Chat Agent model turn ${stepIndex} was projected more than once`);
    }
    step.turn = turn;
    this.reconcileText(step, 'reasoning', turn.reasoningText);
    if (includeAssistant) {
      this.reconcileText(step, 'assistant', turn.assistantText);
    }
    if (step.reasoningItem) {
      step.reasoningItem.turn = turn;
      step.reasoningItem = this.replaceItem(step.reasoningItem, { status: 'sent' });
    }
    if (step.assistantItem) {
      step.assistantItem.turn = turn;
      step.assistantItem = this.replaceItem(step.assistantItem, { status: 'sent' });
    }
    this.publish();
  }

  /** streaming delta 的唯一写入口：首次非空 delta 创建 item，后续只更新原 item。 */
  appendDelta(
    stepIndex: number,
    kind: Extract<AgentTimelineItemKind, 'reasoning' | 'assistant'>,
    text: string,
  ): void {
    if (!text) {
      return;
    }
    const step = this.requireStep(stepIndex);
    const current = kind === 'reasoning' ? step.reasoningItem : step.assistantItem;
    if (!current) {
      const item = this.createTextItem(stepIndex, kind, text);
      if (kind === 'reasoning') {
        step.reasoningItem = item;
      } else {
        step.assistantItem = item;
      }
    } else {
      const updated = this.replaceItem(current, {
        text: current.text + text,
        status: 'streaming',
      });
      if (kind === 'reasoning') {
        step.reasoningItem = updated;
      } else {
        step.assistantItem = updated;
      }
    }
    this.publish();
  }

  /** tool_call_started 只在第一次可见时创建同 step 的一条批次 item。 */
  startToolStatus(stepIndex: number): void {
    const step = this.requireStep(stepIndex);
    if (step.toolItem) {
      return;
    }
    const toolCalls = this.timelineToolCalls(step);
    if (
      toolCalls.length === 0
      || toolCalls.every((toolCall) => toolCall.name === 'requestVideoCall')
    ) {
      return;
    }
    const now = new Date();
    const toolNames = toolCalls.map((toolCall) => toolCall.name);
    const toolDisplayNames = this.resolveToolDisplayNames(toolCalls);
    step.toolItem = this.createItem({
      stepIndex,
      kind: 'tool',
      text: buildToolStatusText(joinToolDisplayNames(toolDisplayNames), 'running'),
      status: 'running',
      createdAt: now.toISOString(),
      time: formatMessageTime(now),
      toolCalls,
      outcomes: step.outcomes,
      toolNames,
      toolDisplayNames,
      turn: step.turn,
    });
    this.publish();
  }

  completeToolCall(
    stepIndex: number,
    toolCallId: string,
    outcome: AgentToolOutcome,
  ): void {
    const step = this.requireStep(stepIndex);
    if (step.outcomes.has(toolCallId)) {
      throw new Error(`Chat Agent tool call ${toolCallId} completed more than once`);
    }
    step.outcomes.set(toolCallId, outcome);
    if (outcome.status === 'success' && isStickerSendIntent(outcome.data)) {
      step.stickerItems.push(this.createStickerTimelineItem(step, toolCallId, outcome.data.sticker));
    }
    if (outcome.status === 'success' && isVoiceMessageSendIntent(outcome.data)) {
      step.voiceItems.push(this.createVoiceTimelineItem(step, toolCallId, outcome.data));
    }
    if (!step.toolItem || !step.turn || step.outcomes.size !== step.turn.toolCalls.length) {
      this.publish();
      return;
    }
    const toolCalls = this.timelineToolCalls(step);
    const toolDisplayNames = this.resolveToolDisplayNames(toolCalls);
    const failed = [...step.outcomes.values()].some(isToolStatusFailure);
    step.toolItem = this.replaceItem(step.toolItem, {
      text: buildToolStatusText(joinToolDisplayNames(toolDisplayNames), failed ? 'failed' : 'completed'),
      status: failed ? 'failed' : 'completed',
      toolNames: toolCalls.map((toolCall) => toolCall.name),
      toolDisplayNames,
    });
    this.publish();
  }

  /** 终态失败时收口 transient 状态；成功路径的 tool completed 已在事件中完成。 */
  closeRun(terminalCode: AgentTerminalCode): void {
    if (terminalCode === 'COMPLETED') {
      return;
    }
    for (const step of this.steps.values()) {
      if (step.toolItem && step.outcomes.size < (step.turn?.toolCalls.length ?? 0)) {
        const toolCalls = this.timelineToolCalls(step);
        step.toolItem = this.replaceItem(step.toolItem, {
          status: 'failed',
          text: buildToolStatusText(
            joinToolDisplayNames(this.resolveToolDisplayNames(toolCalls)),
            'failed',
          ),
          toolNames: toolCalls.map((toolCall) => toolCall.name),
          toolDisplayNames: this.resolveToolDisplayNames(toolCalls),
        });
      }
      if (step.reasoningItem && step.reasoningItem.status !== 'sent') {
        step.reasoningItem = this.replaceItem(step.reasoningItem, { status: 'failed' });
      }
      if (step.assistantItem && step.assistantItem.status !== 'sent') {
        step.assistantItem = this.replaceItem(step.assistantItem, { status: 'failed' });
      }
    }
    this.publish();
  }

  /** 需要 requestVideoCall 等外部动作时，保持原有停止 Runtime 语义。 */
  shouldWaitForExternalAction(): boolean {
    for (const step of this.steps.values()) {
      if (
        step.turn
        && step.turn.toolCalls.length > 0
        && step.turn.toolCalls.every((toolCall) => toolCall.name === 'requestVideoCall')
        && step.outcomes.size === step.turn.toolCalls.length
        && [...step.outcomes.values()].every(isSuppressedSuccessfulOutcome)
      ) {
        return true;
      }
    }
    return false;
  }

  snapshots(): readonly AgentTimelineItemSnapshot[] {
    return this.items.map(toSnapshot);
  }

  /** canonical T3 的唯一纯转换边界。顺序只由 run-local sequence 决定。 */
  buildCommitItems(params: BuildAgentTimelineItemsParams): ConversationTurnCommitItem[] {
    const runtimeContext = params.runtimeContext ?? {};
    const projected: {
      sourceSequence: number;
      segmentIndex: number;
      item: AgentTimelineItem | StickerTimelineItem | VoiceTimelineItem;
      commitItem: ConversationTurnCommitItem;
    }[] = [];

    // 同一 step 必须一次调用 buildAssistantTurnItems：这样 reasoning 与 assistant
    // 共享原有 logicalMessageId、token 归属和分段规则；工具仍由专用 builder 负责。
    for (const step of this.steps.values()) {
      const reasoningItem = step.reasoningItem;
      const assistantItem = step.assistantItem;
      if (reasoningItem || assistantItem) {
        const response = toAIResponseForStep(step);
        const normalized = assistantItem
          ? params.finalAssistantPolicy === 'record_as_activity'
            ? { text: assistantItem.text, segments: [assistantItem.text] }
            : normalizeAssistantResponseText(assistantItem.text, params.policy)
          : { text: '', segments: [] };
        const built = buildAssistantTurnItems({
          sessionId: params.sessionId,
          aiConfig: params.aiConfig,
          runtimeContext,
          response,
          normalizedText: normalized.text,
          visibleSegments: normalized.segments,
        });
        let assistantSegmentIndex = 0;
        for (const entry of built) {
          const target = entry.message.senderType === 'reasoning'
            ? reasoningItem
            : assistantItem;
          if (!target) {
            throw new Error(`Chat Agent step ${step.stepIndex} builder returned an unowned item`);
          }
          const segmentIndex = entry.message.senderType === 'assistant'
            ? assistantSegmentIndex++
            : 0;
          projected.push({
            sourceSequence: target.sequence,
            segmentIndex,
            item: target,
            commitItem: {
              message: this.withStableIdentity(
                params.finalAssistantPolicy === 'record_as_activity'
                  ? { ...entry.message,
                      text: target.text,
                      senderType: entry.message.senderType === 'assistant' ? 'system' : 'reasoning',
                      status: target.status === 'failed' ? 'failed'
                        : target.status === 'running' || target.status === 'streaming' ? 'streaming' : 'sent',
                      metadataJson: JSON.stringify({ ...parseMetadata(entry.message.metadataJson),
                        type: 'agentActivity', source: 'chatAgentRun', phase: entry.message.senderType }),
                    }
                  : entry.message,
                target, segmentIndex,
              ),
            },
          });
        }
      }
      if (step.toolItem) {
        projected.push({
          sourceSequence: step.toolItem.sequence,
          segmentIndex: 0,
          item: step.toolItem,
          commitItem: {
            message: this.buildToolMessage(step.toolItem, params),
          },
        });
      }
      for (const stickerItem of step.stickerItems) {
        projected.push({
          sourceSequence: stickerItem.sequence,
          segmentIndex: 0,
          item: stickerItem,
          commitItem: {
            message: this.buildStickerMessage(stickerItem, params),
          },
        });
      }
      for (const voiceItem of step.voiceItems) {
        projected.push({
          sourceSequence: voiceItem.sequence,
          segmentIndex: 0,
          item: voiceItem,
          commitItem: this.buildVoiceMessage(voiceItem, params),
        });
      }
    }

    const commitItems = projected
      .sort((left, right) => left.sourceSequence - right.sourceSequence || left.segmentIndex - right.segmentIndex)
      .map((entry) => entry.commitItem);
    return commitItems;
  }

  /** supersede/cancel/fence failure 后清理旧 run transient，避免新 run 被旧投影回灌。 */
  clear(reason?: 'superseded' | 'cancelled' | 'fence_failed' | 'model_failure' | 'completed'): void {
    for (const step of this.steps.values()) {
      for (const item of step.voiceItems) {
        // clear 只在本 run 确定不会提交时执行，因此按“事务未提交”语义清理。
        void item.intent.preparedMedia.discardAfterRollback().catch((error) => {
          console.warn('[ChatAgentTimeline] 清理未提交语音媒体失败', error);
        });
      }
    }
    this.items.length = 0;
    this.steps.clear();
    this.nextSequence = 1;
    this.sink.onCleared?.({ runId: this.runId, reason });
  }

  /** T3 提交后的 replacement 先通知 sink，再丢弃 execution-side timeline。 */
  commit(
    messages: readonly ChatMessage[],
    outcome: 'committed' | 'fence_failed' | 'empty_items',
  ): void {
    this.sink.onCommitted?.({ runId: this.runId, messages, outcome });
    this.items.length = 0;
    this.steps.clear();
    this.nextSequence = 1;
  }

  private reconcileText(
    step: TimelineStep,
    kind: Extract<AgentTimelineItemKind, 'reasoning' | 'assistant'>,
    text: string,
  ): void {
    const current = kind === 'reasoning' ? step.reasoningItem : step.assistantItem;
    const currentText = current?.text ?? '';
    if (text === currentText) {
      return;
    }
    if (!text.startsWith(currentText)) {
      throw new Error(`Chat Agent ${kind} payload conflicts at step ${step.stepIndex}`);
    }
    this.appendDelta(step.stepIndex, kind, text.slice(currentText.length));
  }

  private timelineToolCalls(step: TimelineStep): ModelToolCall[] {
    if (!step.turn) {
      throw new Error(`Chat Agent tool event references step ${step.stepIndex} before model turn`);
    }
    return step.turn.toolCalls.filter((toolCall) => !this.timelineHidden(toolCall.name));
  }

  private createTextItem(
    stepIndex: number,
    kind: Extract<AgentTimelineItemKind, 'reasoning' | 'assistant'>,
    text: string,
  ): AgentTimelineItem {
    const now = new Date();
    return this.createItem({
      stepIndex,
      kind,
      text,
      status: 'streaming',
      createdAt: now.toISOString(),
      time: formatMessageTime(now),
      toolCalls: [],
      outcomes: new Map(),
      turn: null,
    });
  }

  private createStickerTimelineItem(
    step: TimelineStep,
    toolCallId: string,
    sticker: StickerMessageSnapshot,
  ): StickerTimelineItem {
    const now = new Date();
    return {
      sequence: this.nextSequence++,
      stepIndex: step.stepIndex,
      toolCallId,
      sticker,
      apiMessageId: step.turn?.messageId ?? null,
      createdAt: now.toISOString(),
      time: formatMessageTime(now),
    };
  }

  private createVoiceTimelineItem(
    step: TimelineStep,
    toolCallId: string,
    intent: VoiceMessageSendIntent,
  ): VoiceTimelineItem {
    const now = new Date();
    return {
      sequence: this.nextSequence++,
      stepIndex: step.stepIndex,
      toolCallId,
      intent,
      apiMessageId: step.turn?.messageId ?? null,
      createdAt: now.toISOString(),
      time: formatMessageTime(now),
    };
  }

  private createItem(params: {
    stepIndex: number;
    kind: AgentTimelineItemKind;
    text: string;
    status: AgentTimelineItemStatus;
    createdAt: string;
    time: string;
    toolCalls: readonly ModelToolCall[];
    outcomes: ReadonlyMap<string, AgentToolOutcome>;
    turn: ChatAgentModelTurn | null;
    toolNames?: readonly string[];
    toolDisplayNames?: readonly string[];
  }): AgentTimelineItem {
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    const item: AgentTimelineItem = {
      runId: this.runId,
      sequence,
      identity: buildAgentTimelineIdentity(this.runId, sequence),
      stepIndex: params.stepIndex,
      kind: params.kind,
      status: params.status,
      text: params.text,
      clientMessageId: buildAgentTimelineClientMessageId(this.runId, sequence),
      createdAt: params.createdAt,
      time: params.time,
      toolNames: params.toolNames,
      toolDisplayNames: params.toolDisplayNames,
      toolCalls: params.toolCalls,
      outcomes: params.outcomes,
      turn: params.turn,
    };
    this.items.push(item);
    return item;
  }

  private replaceItem(
    item: AgentTimelineItem,
    updates: Partial<Pick<AgentTimelineItem, 'text' | 'status' | 'toolNames' | 'toolDisplayNames'>>,
  ): AgentTimelineItem {
    const replacement = { ...item, ...updates };
    const index = this.items.findIndex((candidate) => candidate.sequence === item.sequence);
    if (index < 0) {
      throw new Error(`Chat Agent timeline item ${item.identity} is not owned by this run`);
    }
    this.items[index] = replacement;
    return replacement;
  }

  private withStableIdentity(
    message: CreateMessageInput,
    item: AgentTimelineItem,
    segmentIndex: number,
  ): CreateMessageInput {
    const clientMessageId = buildAgentTimelineClientMessageId(
      this.runId,
      item.sequence,
      segmentIndex,
    );
    const metadata = parseMetadata(message.metadataJson);
    return {
      ...message,
      clientMessageId,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      time: item.time,
      logicalMessageId: buildAgentTimelineLogicalMessageId(this.runId, item.stepIndex),
      metadataJson: JSON.stringify({
        ...metadata,
        transientIdentity: clientMessageId,
        timelineSequence: item.sequence,
        timelineKind: item.kind,
        stepIndex: item.stepIndex,
      }),
    };
  }

  private buildToolMessage(
    item: AgentTimelineItem,
    params: BuildAgentTimelineItemsParams,
  ): CreateMessageInput {
    if (!params.aiConfig) {
      throw new Error('canonical Agent tool timeline requires aiConfig');
    }
    const runtimeContext = params.runtimeContext ?? {};
    const toolNames = [...(item.toolNames ?? [])];
    const toolDisplayNames = [...(item.toolDisplayNames ?? [])];
    const status = item.status === 'failed' ? 'failed' : item.status === 'completed' ? 'completed' : 'running';
    const metadata = buildChatToolStatusMessageMetadata({
      aiConfig: params.aiConfig,
      runtimeContext,
      status,
      toolNames,
      toolDisplayNames,
      displayText: item.text,
    });
    return {
      sessionId: params.sessionId,
      text: item.text,
      isMe: false,
      senderType: 'system',
      agentId: params.aiConfig.agentId,
      apiMessageId: item.turn?.messageId ?? null,
      clientMessageId: item.clientMessageId,
      time: item.time,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      replyToId: null,
      replyToText: null,
      status: status === 'running' ? 'streaming' : status === 'failed' ? 'failed' : 'sent',
      tokensUsed: item.turn?.usage.totalTokens ?? 0,
      promptTokens: item.turn?.usage.promptTokens ?? 0,
      completionTokens: item.turn?.usage.completionTokens ?? 0,
      metadataJson: JSON.stringify({
        ...metadata,
        transientIdentity: item.clientMessageId,
        timelineSequence: item.sequence,
        timelineKind: item.kind,
        stepIndex: item.stepIndex,
      }),
    };
  }

  private buildStickerMessage(
    item: StickerTimelineItem,
    params: BuildAgentTimelineItemsParams,
  ): CreateMessageInput {
    const runtimeContext = params.runtimeContext ?? {};
    const clientMessageId = buildAgentTimelineClientMessageId(this.runId, item.sequence);
    const metadata = buildMessageMetadata(params.aiConfig, runtimeContext, {
      kind: 'sticker',
      sticker: item.sticker,
    });
    return {
      sessionId: params.sessionId,
      text: '',
      isMe: false,
      senderType: 'assistant',
      agentId: params.aiConfig?.agentId ?? null,
      apiMessageId: item.apiMessageId,
      clientMessageId,
      time: item.time,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent',
      deliveryStatus: 'delivered',
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      logicalMessageId: buildAgentTimelineLogicalMessageId(this.runId, item.stepIndex),
      metadataJson: JSON.stringify({
        ...metadata,
        transientIdentity: clientMessageId,
        timelineSequence: item.sequence,
        timelineKind: 'sticker',
        stepIndex: item.stepIndex,
      }),
    };
  }

  private buildVoiceMessage(
    item: VoiceTimelineItem,
    params: BuildAgentTimelineItemsParams,
  ): ConversationTurnCommitItem {
    const runtimeContext = params.runtimeContext ?? {};
    const clientMessageId = buildAgentTimelineClientMessageId(this.runId, item.sequence);
    const baseMetadata = buildMessageMetadata(params.aiConfig, runtimeContext, {
      transientIdentity: clientMessageId,
      timelineSequence: item.sequence,
      timelineKind: 'voice',
      stepIndex: item.stepIndex,
    });
    const message: CreateMessageInput = {
      sessionId: params.sessionId,
      text: item.intent.transcript,
      isMe: false,
      senderType: 'assistant',
      agentId: params.aiConfig?.agentId ?? null,
      apiMessageId: item.apiMessageId,
      clientMessageId,
      time: item.time,
      createdAt: item.createdAt,
      updatedAt: item.createdAt,
      replyToId: null,
      replyToText: null,
      status: 'sent',
      deliveryStatus: 'delivered',
      voicePlayedAt: null,
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      logicalMessageId: buildAgentTimelineLogicalMessageId(this.runId, item.stepIndex),
      metadataJson: JSON.stringify(baseMetadata),
    };
    return {
      message,
      materializeInTransaction: async (transaction, input) => {
        const [asset] = (await item.intent.preparedMedia.commitInTransaction(transaction)).assets;
        return {
          ...input,
          metadataJson: JSON.stringify({
            ...baseMetadata,
            ...buildChatVoiceMessageMetadata({
              schemaVersion: 1,
              mediaAssetId: asset.id,
              mimeType: asset.mimeType,
              // 语音时长是本次 send intent 已确定的业务事实。MediaAsset 可能被 catalog
              // 复用为历史行，其 durationMs 只是资产 metadata，不能反向覆盖本次
              // 语音消息的 duration。
              durationMs: item.intent.durationMs,
              transcriptSource: 'assistant_source_text',
            }),
          }),
        };
      },
      finalizeAfterCommit: () => item.intent.preparedMedia.finalizeAfterCommit(),
      // T3 已确认未提交（fence 失败或事务回滚）时才允许按回滚清理 prepared backing。
      discardAfterRollback: () => item.intent.preparedMedia.discardAfterRollback(),
    };
  }

  private publish(): void {
    this.sink.onChanged?.({
      runId: this.runId,
      items: this.snapshots(),
    });
  }

  private resolveToolDisplayNames(toolCalls: readonly ModelToolCall[]): string[] {
    return toolCalls.map((toolCall) => resolveToolCallDisplayName(toolCall));
  }

  private requireStep(stepIndex: number): TimelineStep {
    const step = this.steps.get(stepIndex);
    if (!step) {
      throw new Error(`Chat Agent event references unknown step ${stepIndex}`);
    }
    return step;
  }
}

export function buildAgentTimelineLogicalMessageId(runId: string, stepIndex: number): string {
  return `agent_timeline:${encodeURIComponent(runId)}:step:${stepIndex}`;
}

function toSnapshot(item: AgentTimelineItem): AgentTimelineItemSnapshot {
  return {
    runId: item.runId,
    sequence: item.sequence,
    identity: item.identity,
    stepIndex: item.stepIndex,
    kind: item.kind,
    status: item.status,
    text: item.text,
    clientMessageId: item.clientMessageId,
    createdAt: item.createdAt,
    time: item.time,
    apiMessageId: item.turn?.messageId ?? null,
    toolNames: item.toolNames,
    toolDisplayNames: item.toolDisplayNames,
  };
}

function toAIResponseForStep(step: TimelineStep): AIResponse {
  const turn = step.turn;
  return {
    success: true,
    text: step.assistantItem?.text ?? '',
    reasoningText: step.reasoningItem?.text,
    messageId: turn?.messageId ?? null,
    totalTokens: turn?.usage.totalTokens ?? 0,
    promptTokens: turn?.usage.promptTokens ?? 0,
    completionTokens: turn?.usage.completionTokens ?? 0,
    isToolCall: Boolean(turn && turn.toolCalls.length > 0),
    toolCalls: turn?.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: 'function' as const,
      function: {
        name: toolCall.name,
        arguments: toolCall.arguments,
      },
    })) ?? [],
  };
}

function parseMetadata(metadataJson: string | null | undefined): Record<string, unknown> {
  if (!metadataJson) {
    return {};
  }
  const metadata = JSON.parse(metadataJson) as unknown;
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Chat Agent timeline message metadata must be an object');
  }
  return metadata as Record<string, unknown>;
}

function isSuppressedSuccessfulOutcome(outcome: AgentToolOutcome): boolean {
  return outcome.status === 'success' && outcome.metadata?.suppressAssistantReply === true;
}

function isToolStatusFailure(outcome: AgentToolOutcome): boolean {
  return outcome.status === 'error';
}
