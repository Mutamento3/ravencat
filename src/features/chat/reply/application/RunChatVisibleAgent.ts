/** 将非用户消息触发的 Agent run 投影并持久化到既有 Chat 时间线。 */
import type {
  AgentRunEvent, AgentRunModelGateway, AgentRunResult, AgentRuntimeRequest,
  BaseAIClientAgentModelTurn,
} from '@platform/agentRuntime';
import type { AgentToolExecutionContext, ToolContext } from '@shared/aiTools';
import { databaseCoordinator } from '@platform/persistence';
import type { ChatMessage, CreateMessageInput } from '../../messages/domain/ChatMessage';
import { buildSessionPreviewTextFromMessage } from '../../messages/domain';
import { deliverCommittedAssistantSegment } from './CommittedAssistantSegmentDelivery';
import { createAgentTransientTimelineSink } from '../../messages/application/AgentTransientTimeline';
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import { emitChatMessagesUpdated } from '../../messages/events/ChatEvents';
import {
  ChatAgentRunFailedError, ChatAgentRunProjector,
  type AgentTimelineCommitPort, type FinalAssistantPolicy,
} from '../agent/ChatAgentRunProjector';
import type { AIReplyConfig, AIReplyRuntimeContext } from './ChatReplyTypes';
import { getChatReplyRuntimeDependencies } from './ChatReplyRuntimeDependencies';
import { buildMessageMetadata } from './ChatReplyMetadata';
import { formatMessageTime } from './ChatReplyUtils';

const activeActivityRunIds = new Set<string>();

export function listChatAgentActivityEvidence(runIds: readonly string[]) {
  return getChatMessageRuntimeDependencies().messages.listAgentActivityEvidence(runIds);
}

/** 冷启动或回前台只结算旧进程的记录；当前句柄仍由原执行宿主负责。 */
export async function interruptAbandonedChatAgentActivities(): Promise<void> {
  const sessions = await getChatMessageRuntimeDependencies().messages.interruptInactiveAgentActivities(
    [...activeActivityRunIds], new Date().toISOString(),
  );
  sessions.forEach(emitChatMessagesUpdated);
}

export interface ChatVisibleAgentModelGateway extends AgentRunModelGateway {
  takeCompletedTurn(stepIndex: number): BaseAIClientAgentModelTurn;
}

export interface PreparedChatVisibleAgent {
  request: Omit<AgentRuntimeRequest, 'runId' | 'eventSink' | 'modelGateway'>;
  modelGateway: ChatVisibleAgentModelGateway;
  createLegacyContext(context: AgentToolExecutionContext): ToolContext;
}

export interface RunChatVisibleAgentParams {
  sessionId: string;
  runId: string;
  aiConfig: AIReplyConfig;
  runtimeContext: AIReplyRuntimeContext;
  finalAssistantPolicy: FinalAssistantPolicy;
  signal?: AbortSignal;
  /** Chat 先记录开始，再组装模型与工具；准备失败也必须留下执行记录。 */
  prepare(signal: AbortSignal): Promise<PreparedChatVisibleAgent>;
}

/** Chat 拥有过程展示与提交；任务、Prompt、工具授权仍由调用方提供。 */
export async function runChatVisibleAgent(params: RunChatVisibleAgentParams): Promise<AgentRunResult> {
  const replyDependencies = getChatReplyRuntimeDependencies();
  const repository = getChatMessageRuntimeDependencies().messages;
  const cancellation = createProjectionCancellation(params.signal);
  const recordActivity = params.finalAssistantPolicy === 'record_as_activity';
  let nextItemIndex = 1;
  const allocateItemIndex = () => nextItemIndex++;
  const lifecycle = async (phase: 'started' | 'responded' | 'terminal', text: string, terminalCode?: string) => {
    const now = new Date();
    await repository.upsertStatefulTimelineEntry({ previewText: null, message: {
      sessionId: params.sessionId, text, isMe: false, senderType: 'system',
      agentId: params.aiConfig.agentId, status: 'sent', isRead: true,
      clientMessageId: `agent_activity:${params.runId}:${phase}`,
      turnRunId: params.runId, turnItemIndex: allocateItemIndex(),
      createdAt: now.toISOString(), time: formatMessageTime(now),
      metadataJson: JSON.stringify(buildMessageMetadata(params.aiConfig,
        { ...params.runtimeContext, replyRunId: params.runId },
        { type: 'agentActivity', source: 'chatAgentRun', phase, terminalCode })),
    } });
    emitChatMessagesUpdated(params.sessionId);
  };
  const timelineSink = createAgentTransientTimelineSink({
    sessionId: params.sessionId, agentId: params.aiConfig.agentId,
    assistantAsActivity: recordActivity,
  });
  let projector: ChatAgentRunProjector | undefined;
  let projectedTerminal = false;
  let responded = false;
  if (recordActivity) activeActivityRunIds.add(params.runId);
  try {
    if (recordActivity) {
      await lifecycle('started', `${params.runtimeContext.triggerReason === 'self_wake' ? '自主醒来' : '日程唤醒'} · 已开始（尚无结束记录）`);
    }
    const prepared = await params.prepare(cancellation.signal);
    projector = new ChatAgentRunProjector({
      sessionId: params.sessionId, repository,
      callbacks: { notifyUI: emitChatMessagesUpdated }, aiConfig: params.aiConfig,
      runtimeContext: { ...params.runtimeContext, abortSignal: cancellation.signal, replyRunId: params.runId },
      policy: {
        bubbleDeliveryMode: params.aiConfig.allowMultipleBubbles === false ? 'single-bubble' : 'multi-bubble',
        modelTransport: prepared.request.task.modelTransport,
        enableTools: prepared.request.task.allowedToolNames.length > 0,
      },
      projection: {
        kind: 'canonical',
        commit: createStandaloneTimelineCommit(params.runId, repository, allocateItemIndex),
      },
      stopRuntime: cancellation.stop,
      replyRunId: params.runId, finalAssistantPolicy: params.finalAssistantPolicy, timelineSink,
    });
    const projectEvent = async (event: AgentRunEvent): Promise<void> => {
      let outputReceived = (
        ((event.type === 'reasoning_delta' || event.type === 'assistant_text_delta') && event.text.length > 0)
        || event.type === 'tool_call_proposed' || event.type === 'model_tool_request_started'
      );
      if (event.type === 'model_turn_completed') {
        const turn = prepared.modelGateway.takeCompletedTurn(event.stepIndex);
        outputReceived = turn.assistantText.length > 0 || turn.reasoningText.length > 0 || turn.toolCalls.length > 0;
        await projector!.projectModelTurn(event.stepIndex, turn);
      } else {
        await projector!.handleEvent(event);
      }
      if (recordActivity && event.type !== 'run_started' && event.type !== 'run_completed') {
        await projector!.checkpointActivityTimeline();
      }
      if (recordActivity && !responded && outputReceived) {
        await lifecycle('responded', '自主唤醒成功 · AI 已响应（行动结果以工具记录为准）');
        responded = true;
      }
    };
    const result = await replyDependencies.agent.run({
      ...prepared.request, runId: params.runId, signal: cancellation.signal,
      eventSink: projectEvent, modelGateway: prepared.modelGateway,
      createLegacyContext: prepared.createLegacyContext,
    });
    projectedTerminal = true;
    if (result.terminalCode === 'MODEL_REQUEST_FAILED') {
      await projector.failRun(result);
    } else {
      try {
        await projector.completeRun(result);
      } catch (error) {
        if (!(error instanceof ChatAgentRunFailedError && error.terminalCode === result.terminalCode)) throw error;
      }
    }
    if (recordActivity) {
      const text = result.terminalCode === 'COMPLETED' ? responded ? '自主行动 · 执行结束，AI 已响应' : '自主行动 · 未执行（未收到 AI 响应）'
        : result.terminalCode === 'CANCELLED_BY_USER' ? '自主行动 · 已取消'
        : `自主行动 · 执行未成功（${result.terminalCode}）`;
      await lifecycle('terminal', text, result.terminalCode);
    }
    return result;
  } catch (error) {
    if (recordActivity) {
      if (projector && !projectedTerminal) await projector.failActivityRun();
      await lifecycle('terminal', cancellation.signal.aborted ? '自主行动 · 已取消'
        : '自主行动 · 准备或执行异常，未成功结束',
      cancellation.signal.aborted ? 'CANCELLED_BY_USER' : 'EXECUTION_FAILED');
    }
    throw error;
  } finally {
    activeActivityRunIds.delete(params.runId);
    cancellation.dispose();
  }
}

function createStandaloneTimelineCommit(
  runId: string,
  repository: ReturnType<typeof getChatMessageRuntimeDependencies>['messages'],
  allocateItemIndex: () => number,
): AgentTimelineCommitPort {
  const itemIndexes = new Map<string, number>();
  const materializedMessages = new Map<string, CreateMessageInput>();
  const savedItems = new Map<string, { signature: string; message: ChatMessage }>();
  return {
    async commitAgentTimeline(params) {
      if (params.items.length === 0) return { outcome: 'empty_items', messages: [] };
      const preparedItems = params.items.filter((item) => item.materializeInTransaction
        && !materializedMessages.has(item.message.clientMessageId!));
      let results;
      const stagedInputs = new Map<string, CreateMessageInput>();
      const stagedSignatures = new Map<string, string>();
      try {
        results = await databaseCoordinator.openTaskExecutor({
          name: 'chat.persist-agent-activity', feature: 'chat', priority: 'interactive',
        }).withExclusiveTransactionAsync(async (transaction) => {
          const committed = [];
          for (const item of params.items) {
            const identity = item.message.clientMessageId!;
            if (!itemIndexes.has(identity)) itemIndexes.set(identity, allocateItemIndex());
            const previousMediaMessage = materializedMessages.get(identity);
            const message = previousMediaMessage ?? (item.materializeInTransaction
              ? await item.materializeInTransaction(transaction, item.message) : item.message);
            stagedInputs.set(identity, message);
            const ownsDelivery = message.senderType === 'assistant';
            const indexedMessage = { ...message, turnRunId: runId, turnItemIndex: itemIndexes.get(identity)!,
              isRead: ownsDelivery ? message.isRead : true };
            const signature = JSON.stringify(indexedMessage);
            stagedSignatures.set(identity, signature);
            const saved = savedItems.get(identity);
            // 未变化的旧条目无需重复写入，也不能把用户刚读过的媒体再次改成未读。
            if (saved?.signature === signature) {
              committed.push({ message: saved.message, inserted: false });
              continue;
            }
            committed.push(await repository.upsertStatefulTimelineEntryInTransaction(transaction, {
              message: indexedMessage,
              // 过程记录不发通知；语音和贴纸 intent 属于真正的 assistant 消息。
              previewText: ownsDelivery ? buildSessionPreviewTextFromMessage(message) : null,
            }));
          }
          return committed;
        });
      } catch (error) {
        await Promise.all(preparedItems.map((item) => item.discardAfterRollback?.()));
        throw error;
      }
      const messages = results.map((result) => result.message);
      for (const message of messages) {
        const identity = message.clientMessageId!;
        savedItems.set(identity, { signature: stagedSignatures.get(identity)!, message });
      }
      for (const item of preparedItems) {
        const identity = item.message.clientMessageId!;
        materializedMessages.set(identity, stagedInputs.get(identity)!);
        try {
          await item.finalizeAfterCommit?.();
        } catch (error) {
          // 已提交媒体不能再按回滚删除，清理失败只保留诊断。
          console.warn('[ChatVisibleAgent] 已提交媒体清理失败', error);
        }
      }
      emitChatMessagesUpdated(params.sessionId);
      for (const { message, inserted } of results) {
        if (!inserted || message.senderType !== 'assistant') continue;
        await deliverCommittedAssistantSegment({
          sessionId: params.sessionId, text: message.text, metadataJson: message.metadataJson,
          messageId: message.id, logicalMessageId: message.logicalMessageId ?? null,
          segmentIndex: 0, segmentTotal: 1, aiConfig: params.aiConfig,
          runtimeContext: params.runtimeContext ?? {}, callbacks: params.callbacks ?? {},
        });
      }
      return { outcome: 'committed', messages };
    },
  };
}

function createProjectionCancellation(source: AbortSignal | undefined) {
  const controller = new AbortController();
  const forward = () => controller.abort(source?.reason);
  if (source?.aborted) forward();
  else source?.addEventListener('abort', forward, { once: true });
  return {
    signal: controller.signal,
    stop: () => controller.abort('CANCELLED_BY_USER'),
    dispose: () => source?.removeEventListener('abort', forward),
  };
}
