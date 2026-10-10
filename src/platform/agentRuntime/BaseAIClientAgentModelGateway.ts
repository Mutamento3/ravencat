/** 把 BaseAIClient 的 complete/stream 调用适配为 Agent Runtime 单轮模型网关。 */
import {
  AgentModelGateway,
  type AgentModelProvider,
  type BaseAIClient,
  type ChatMessage,
  type ModelEvent,
  type ModelHistoryItem,
  type ModelTurnResult,
  type ToolDefinition,
} from '@platform/ai';
import type { AgentToolDescriptor } from '@shared/aiTools';
import type { PromptToolInstructionsSlot } from '@shared/prompt';
import { logTurnTimeline, type TurnTimelineContext } from '@shared/diagnostics/TurnTimelineLog';
import type {
  AgentModelTurnRequest,
  AgentRunModelGateway,
} from './AgentRunLoop';

export class BaseAIClientAgentModelRequestError extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'BaseAIClientAgentModelRequestError';
  }
}

export interface BaseAIClientAgentModelTurn extends ModelTurnResult {
  messageId: string | null;
}

export interface BaseAIClientAgentModelGatewayParams {
  client: BaseAIClient;
  initialMessages: readonly ChatMessage[];
  toolInstructionsSlot?: PromptToolInstructionsSlot;
  diagnosticContext: TurnTimelineContext;
}

export class BaseAIClientAgentModelGateway implements AgentRunModelGateway {
  private readonly gateway: AgentModelGateway;
  private readonly initialMessages: readonly ChatMessage[];
  private readonly toolInstructionsSlot: PromptToolInstructionsSlot | undefined;
  private readonly completedTurns = new Map<number, BaseAIClientAgentModelTurn>();
  private nextStepIndex = 1;
  private providerMessageId: string | null = null;
  private modelRequestError: BaseAIClientAgentModelRequestError | null = null;
  private observedModelOutput = false;
  private readonly diagnosticContext: TurnTimelineContext;

  constructor(params: BaseAIClientAgentModelGatewayParams) {
    const provider: AgentModelProvider = {
      chatWithTools: async (messages, tools, options) => {
        // 空工具集必须走无工具入口，避免 Provider 仍发送 tools/tool_choice。
        if (tools.length === 0) {
          const response = await params.client.chat(messages, {
            includeSystemPrompt: options?.includeSystemPrompt,
            enforceReasoningContent: options?.enforceReasoningContent,
            allowReasoningLengthRetry: true,
            signal: options?.signal,
          });
          this.providerMessageId = response.messageId;
          return response;
        }

        const response = await params.client.chatWithTools(messages, tools, {
          ...options,
          allowReasoningLengthRetry: true,
        });
        this.providerMessageId = response.messageId;
        return response;
      },
      chatStreamWithTools: async (messages, tools, options) => {
        if (tools.length === 0) {
          const response = await params.client.chatStream(messages, {
            includeSystemPrompt: options?.includeSystemPrompt,
            enforceReasoningContent: options?.enforceReasoningContent,
            signal: options?.signal,
            onDelta: options?.onDelta,
          });
          logTurnTimeline('model_stream_completed', this.diagnosticContext);
          this.providerMessageId = response.messageId;
          return response;
        }

        const response = await params.client.chatStreamWithTools(messages, tools, options);
        logTurnTimeline('model_stream_completed', this.diagnosticContext);
        this.providerMessageId = response.messageId;
        return response;
      },
    };
    this.gateway = new AgentModelGateway(provider);
    this.initialMessages = params.initialMessages;
    this.toolInstructionsSlot = params.toolInstructionsSlot;
    this.diagnosticContext = params.diagnosticContext;
  }

  async runTurn(
    request: AgentModelTurnRequest,
    emitModelEvent?: Parameters<AgentRunModelGateway['runTurn']>[1]
  ): Promise<ModelTurnResult> {
    this.providerMessageId = null;
    this.modelRequestError = null;
    let firstStreamDeltaLogged = false;
    const forwardModelEvent = async (event: ModelEvent): Promise<void> => {
      this.observedModelOutput = this.observedModelOutput || isModelOutputEvent(event);
      if (
        request.transport === 'stream'
        && !firstStreamDeltaLogged
        && isRealStreamOutputEvent(event)
      ) {
        firstStreamDeltaLogged = true;
        logTurnTimeline('first_delta_received', this.diagnosticContext);
      }
      await emitModelEvent?.(event);
    };
    logTurnTimeline('model_request_started', this.diagnosticContext);
    try {
      let initialMessages = this.initialMessages;
      const slot = this.toolInstructionsSlot;
      const instructions = request.toolInstructions;
      const resolvesToolPrompt = slot !== undefined && instructions !== undefined;
      if (resolvesToolPrompt) {
        const currentContext = [slot.contextBefore, instructions.state, slot.contextAfter].filter(Boolean).join('\n\n');
        const systemPrompt = [slot.before, instructions.catalog, slot.after,
          ...(slot.contextMessageIndex === null ? [currentContext] : [])].filter(Boolean).join('\n\n');
        initialMessages = [
          { role: 'system', content: systemPrompt },
          ...this.initialMessages.map((message, index): ChatMessage => (
            index === slot.contextMessageIndex ? { role: 'system', content: currentContext } : message
          )),
        ];
      }
      const requestParams = {
        messages: buildAgentModelMessages(
          initialMessages,
          request.history,
          request.toolBudget,
          request.tools.length > 0,
          request.completionContinuationInstruction,
        ),
        // 完整前置 system 已在请求中，禁止 BaseAIClient 再注入配置里的旧版本。
        includeSystemPrompt: !resolvesToolPrompt,
        tools: request.tools.map(toProviderToolDefinition),
        toolChoice: 'auto' as const,
        signal: request.signal,
      };
      const turn = request.transport === 'complete'
        ? await this.gateway.complete(requestParams, forwardModelEvent)
        : await this.gateway.stream(requestParams, forwardModelEvent);
      const stepIndex = this.nextStepIndex;
      this.nextStepIndex += 1;
      console.info('[AgentModelTrace] model_turn_completed', {
        transport: request.transport,
        stepIndex,
        finishReason: turn.finishReason,
        assistantTextLength: turn.assistantText.length,
        reasoningTextLength: turn.reasoningText.length,
        toolCallCount: turn.toolCalls.length,
        providerMessageId: this.providerMessageId,
      });
      this.completedTurns.set(stepIndex, {
        ...turn,
        messageId: this.providerMessageId,
      });
      return turn;
    } catch (error) {
      this.modelRequestError = this.createModelRequestError(error);
      throw error;
    }
  }

  takeCompletedTurn(stepIndex: number): BaseAIClientAgentModelTurn {
    const turn = this.completedTurns.get(stepIndex);
    if (!turn) {
      throw new Error(`Agent model turn ${stepIndex} was not captured`);
    }
    this.completedTurns.delete(stepIndex);
    return turn;
  }

  requireModelRequestError(): BaseAIClientAgentModelRequestError {
    if (!this.modelRequestError) {
      throw new Error('Agent model request failed without a captured Provider error');
    }
    return this.modelRequestError;
  }

  hasObservedModelOutput(): boolean {
    return this.observedModelOutput;
  }

  protected createModelRequestError(error: unknown): BaseAIClientAgentModelRequestError {
    return new BaseAIClientAgentModelRequestError(error);
  }
}

export function buildAgentModelMessages(
  initialMessages: readonly ChatMessage[],
  history: readonly ModelHistoryItem[],
  toolBudget?: AgentModelTurnRequest['toolBudget'],
  hasTools = false,
  completionContinuationInstruction?: string,
): ChatMessage[] {
  const budgetMessage = buildToolBudgetMessage(toolBudget, hasTools);
  return [
    ...initialMessages,
    ...history.map((item): ChatMessage => {
      if (item.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: item.toolCallId,
          name: item.name,
          content: item.content,
        };
      }

      return {
        role: 'assistant',
        content: item.content,
        reasoning_content: item.reasoningText || ' ',
        tool_calls: item.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: 'function',
          function: {
            name: toolCall.name,
            arguments: toolCall.arguments,
          },
        })),
      };
    }),
    // 每步变化的预算与收口指令放在真实调用记录之后，保留已完成步骤的连续前缀。
    ...(completionContinuationInstruction ? [{
      role: 'system' as const,
      content: completionContinuationInstruction,
    }] : []),
    ...(budgetMessage ? [budgetMessage] : []),
  ];
}

function buildToolBudgetMessage(
  budget: AgentModelTurnRequest['toolBudget'] | undefined,
  hasTools: boolean,
): ChatMessage | null {
  if (!budget) {
    return null;
  }
  if (budget.forceFinalResponse) {
    return {
      role: 'system',
      content: '工具调用阶段已经结束。本轮不得请求任何工具；请仅根据已有上下文和工具结果，给出本次 Agent run 的完整最终输出。',
    };
  }
  if (!hasTools) {
    return null;
  }
  return {
    role: 'system',
    content: `本次 Agent run 还可调用 ${budget.remainingToolCalls} 次工具，本轮最多提出 ${budget.maxToolCallsPerStep} 个工具调用。请控制调用数量；信息足够时直接给出本次 Agent run 的最终输出。`,
  };
}

function toProviderToolDefinition(descriptor: AgentToolDescriptor): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: descriptor.name,
      description: descriptor.description,
      parameters: descriptor.inputSchema,
    },
  };
}

function isModelOutputEvent(event: ModelEvent): boolean {
  if (event.type === 'reasoning_delta' || event.type === 'assistant_text_delta') {
    return event.text.length > 0;
  }
  if (event.type === 'assistant_text_completed') {
    return event.text.length > 0;
  }
  if (event.type === 'tool_call_started' || event.type === 'tool_call_arguments_delta') {
    return true;
  }
  if (event.type === 'tool_call_completed') {
    return true;
  }
  return false;
}

function isRealStreamOutputEvent(event: ModelEvent): boolean {
  if (event.type === 'reasoning_delta' || event.type === 'assistant_text_delta') {
    return event.text.length > 0;
  }
  if (event.type === 'tool_call_started') {
    return true;
  }
  if (event.type === 'tool_call_arguments_delta') {
    return event.delta.length > 0;
  }
  return false;
}
