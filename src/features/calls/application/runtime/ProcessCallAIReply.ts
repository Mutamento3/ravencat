/** 生成通话中的 AI 回复，并处理通话专用工具、视觉上下文与结束指令。 */

import { discardCallSnapshots } from '../snapshots/CallSnapshotLifetime';

import type { CallEvent } from '../../domain/CallEvent';
import type { CallAIConfig } from '../../domain/CallAIConfig';
import {
  createAIClient,
  getErrorDisplayInfo,
  type ChatMessage as AIChatMessage,
  type ChatResponse,
  type ChatStreamDelta,
  type ContentPart,
  type ToolCall as AIClientToolCall,
  type ToolDefinition as AIClientToolDefinition,
} from '@platform/ai';
import { ToolContext } from '@shared/aiTools';
import { DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT } from '@shared/prompt';
import { LookAtUserTool } from '../../aiTools/LookAtUserTool';
import { appendAISpeechText, appendUserSpeechText } from '../events/AppendCallTranscriptEvent';
import { getCallRuntimeDependencies } from './CallRuntimeDependencies';
import {
  CallReplyRunCancelledError,
  isCallReplyCancellationError,
} from './CallReplyRunState';
import { createCallSpeechSentenceStream } from './CallSpeechSentenceStream';
import { buildCallLivePromptBlocks } from '../CallPromptBlocks';
import { resolveTextToSpeechModel, readSpeechMetadata, getSpeechTextGuidance } from '@features/speech';
import type { CallSentenceSpeech } from './CallSpeechSentenceStream';

interface CallAIClient {
  chat(messages: AIChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatResponse>;
  chatStreamWithTools(
    messages: AIChatMessage[],
    tools: AIClientToolDefinition[],
    options?: {
      toolChoice?: 'auto' | 'none';
      signal?: AbortSignal;
      onDelta?: (delta: ChatStreamDelta) => void | Promise<void>;
    }
  ): Promise<ChatResponse>;
}

type CallToolExecuteResult = {
  success: boolean;
  message?: string;
  error?: string;
  data?: any;
  suppressAssistantReply?: boolean;
};

type CallToolCallResult = {
  toolCallId: string;
  name: string;
  result: CallToolExecuteResult;
};

export type ProcessCallAIReplyResult =
  | {
      status: 'completed';
      userEvent: CallEvent;
      aiEvent: CallEvent;
      text: string;
      callEnded: boolean;
    }
  | {
      status: 'failed';
      userEvent: CallEvent | null;
      errorMessage: string;
    }
  | {
      status: 'cancelled';
      userEvent: CallEvent | null;
    };

export async function processCallAIReply(params: {
  callId: string;
  userText: string;
  aiConfig: CallAIConfig;
  signal: AbortSignal;
  /** 正文供字幕和提交，合成输入与模型快照供同一播放队列消费。 */
  onSpeechSentence?: (sentence: string, speech: CallSentenceSpeech) => void;
}): Promise<ProcessCallAIReplyResult> {
  const text = params.userText.trim();
  if (!text) {
    throw new Error('通话文本不能为空');
  }

  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(params.callId);
  if (!call) {
    throw new Error(`Call ${params.callId} not found`);
  }
  if (call.state !== 'active') {
    throw new Error('当前通话不在接通状态');
  }

  const userEvent = await appendUserSpeechText({
    callId: call.id,
    text,
  });

  try {
    const runtimeDependencies = getCallRuntimeDependencies();
    const speechModel = await resolveTextToSpeechModel({ assistantId: params.aiConfig.id, consumer: 'call' });
    const speechTextGuidance = speechModel
      ? getSpeechTextGuidance(readSpeechMetadata(speechModel.metadataJson).provider, speechModel.model, false)
      : undefined;
    const callAIConfig: CallAIConfig = {
      ...params.aiConfig,
      allowMultipleBubbles: false,
      enableTools: true,
    };
    // 通话沿用单聊的摘要与完整未总结原文；主条数由 Chat 用作摘要触发门槛。
    const recentWindowLimit =
      callAIConfig.privateContextPrimaryLimit || DEFAULT_PRIVATE_CONTEXT_PRIMARY_LIMIT;
    const toolContext = new ToolContext({
      aiConfig: callAIConfig,
      sessionId: call.chatSessionId,
      abortSignal: params.signal,
      triggerSource: 'call',
      triggerReason: 'call_user_text',
      relatedEntityType: 'call',
      relatedEntityId: call.id,
      capabilities: ['call.reply', 'call.lookAtUser'],
      repositories: {
        protocol: runtimeDependencies.repositories.protocol,
        moment: runtimeDependencies.repositories.moment,
        profile: runtimeDependencies.repositories.profile,
        ledger: runtimeDependencies.repositories.ledger,
      },
    });
    const promptPack = await runtimeDependencies.assembleChatPromptPack({
      sessionId: call.chatSessionId,
      currentInput: text,
      aiConfig: callAIConfig,
      toolContext,
      runtimeContext: {
        triggerSource: 'call',
        triggerReason: 'call_user_text',
        relatedEntityType: 'call',
        relatedEntityId: call.id,
        capabilities: ['call.reply', 'call.lookAtUser'],
        recentWindowLimit,
        currentCallEventId: userEvent.id,
        memoryParticipation: 'read_only',
        forceAppendUserText: true,
      },
      recentWindowLimit,
      additionalBlocks: buildCallLivePromptBlocks(call, speechTextGuidance),
    });

    const client = createAIClient({
      baseURL: callAIConfig.apiBaseUrl,
      apiKey: callAIConfig.apiKey,
      model: callAIConfig.model,
      temperature: callAIConfig.temperature,
      topP: callAIConfig.topP,
      disableThinking: callAIConfig.disableThinking,
      maxTokens: callAIConfig.maxTokens,
      systemPrompt: promptPack.systemPrompt,
    });
    const requestMessages = await buildCallModelMessages({
      modelMessages: promptPack.modelMessages,
    });

    // 流式只是传输形式：delta 只驱动按句 TTS，不落库；
    // aiSpeechText 仍在完整回复收齐并校验后一次性提交。
    const speechStream = createCallSpeechSentenceStream((sentence, speech) => {
      params.onSpeechSentence?.(sentence, speech);
    }, speechModel);

    let response = await client.chatStreamWithTools(requestMessages, [
      {
        type: 'function',
        function: LookAtUserTool.definition,
      },
    ], {
      toolChoice: 'auto',
      signal: params.signal,
      onDelta: (delta) => {
        if (delta.type === 'answer_delta') {
          speechStream.push(delta.text);
        }
      },
    });

    if (response.success && response.isToolCall && response.toolCalls) {
      response = await continueCallReplyWithToolResults({
        callId: call.id,
        client,
        requestMessages,
        response,
        toolContext,
        signal: params.signal,
      });
      if (response.success) {
        // 续轮正文整体到达（本批不强制续轮流式），同样走按句切分管线；
        // 工具调用前的流式正文已逐句产出，最终一并计入一次性提交的完整回复。
        speechStream.pushSegment(String(response.text || ''));
      }
    }

    if (!response.success) {
      const errorInfo = getErrorDisplayInfo(new Error(response.error || 'Unknown error'));
      await appendCallError(call.id, call.chatSessionId, errorInfo.message);
      return {
        status: 'failed',
        userEvent,
        errorMessage: errorInfo.message,
      };
    }

    await assertCallReplyCanCommit(call.id, params.signal);
    speechStream.flush();

    let fullText = speechStream.getSentences().join('\n');
    if (!fullText) {
      // 空回复兜底：与旧链路一致，给一句可朗读的占位并进入 TTS。
      speechStream.push('我在。');
      speechStream.flush();
      fullText = speechStream.getSentences().join('\n');
    }

    const aiEvent = await appendAISpeechText({
      callId: call.id,
      text: fullText,
    });

    return {
      status: 'completed',
      userEvent,
      aiEvent,
      text: aiEvent.text || '',
      callEnded: speechStream.shouldEndCall(),
    };
  } catch (error) {
    if (isCallReplyCancellationError(error)) {
      return {
        status: 'cancelled',
        userEvent,
      };
    }
    const errorMessage = error instanceof Error ? error.message : '通话回复失败';
    await appendCallError(call.id, call.chatSessionId, errorMessage);
    return {
      status: 'failed',
      userEvent,
      errorMessage,
    };
  }
}

async function appendCallError(
  callId: string,
  chatSessionId: string,
  text: string
): Promise<void> {
  await getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId,
    chatSessionId,
    kind: 'error',
    actorType: 'system',
    text,
    visibleInChat: false,
    includeInAIContext: true,
  });
}

async function continueCallReplyWithToolResults(params: {
  callId: string;
  client: CallAIClient;
  requestMessages: AIChatMessage[];
  response: ChatResponse;
  toolContext: ToolContext;
  signal: AbortSignal;
}): Promise<ChatResponse> {
  throwIfAborted(params.callId, params.signal);
  const toolCalls = params.response.toolCalls || [];
  const toolResults = await executeCallToolCalls(toolCalls, params.toolContext);
  try {
    throwIfAborted(params.callId, params.signal);
    const messages: AIChatMessage[] = [
      ...params.requestMessages,
      {
        role: 'assistant',
        content: params.response.text || '',
        reasoning_content: ' ',
        tool_calls: toolCalls,
      },
      ...toolResults.map((toolResult) => ({
        role: 'tool' as const,
        tool_call_id: toolResult.toolCallId,
        content: JSON.stringify(toolResult.result),
      })),
    ];

    const capturedSnapshot = toolResults.some((toolResult) => {
      const data = toolResult.result?.data as { status?: string } | undefined;
      return toolResult.name === LookAtUserTool.name && data?.status === 'captured';
    });
    if (capturedSnapshot) {
      const visionContext = await buildLookAtUserVisionContext({
        callId: params.callId,
        aiConfig: params.toolContext.aiConfig as CallAIConfig,
      });
      if (visionContext) {
        messages.push({
          role: 'user',
          content: visionContext,
        });
      }
    }

    return await params.client.chat(messages, { signal: params.signal });
  } finally {
    const attachmentIds = toolResults.flatMap(({ result }) => {
      const data = result.data as { status?: string; attachmentId?: string } | undefined;
      return data?.status === 'captured' && data.attachmentId ? [data.attachmentId] : [];
    });
    if (attachmentIds.length > 0) await discardCallSnapshots(params.callId, attachmentIds);
  }
}

async function assertCallReplyCanCommit(callId: string, signal: AbortSignal): Promise<void> {
  throwIfAborted(callId, signal);
  const currentCall = await getCallRuntimeDependencies().repositories.calls.getSessionById(callId);
  throwIfAborted(callId, signal);
  if (!currentCall || currentCall.state !== 'active') {
    throw new CallReplyRunCancelledError(callId);
  }
}

function throwIfAborted(callId: string, signal: AbortSignal): void {
  if (signal.aborted) {
    throw new CallReplyRunCancelledError(callId);
  }
}

async function executeCallToolCalls(
  toolCalls: AIClientToolCall[],
  context: ToolContext
): Promise<CallToolCallResult[]> {
  const results: CallToolCallResult[] = [];

  for (const toolCall of toolCalls) {
    const toolName = toolCall.function.name;

    if (toolName !== LookAtUserTool.name) {
      results.push({
        toolCallId: toolCall.id,
        name: toolName,
        result: {
          success: false,
          error: `未知通话工具: ${toolName}`,
        },
      });
      continue;
    }

    let args: Record<string, any>;
    try {
      const parsedArgs = JSON.parse(toolCall.function.arguments || '{}');
      args = parsedArgs && typeof parsedArgs === 'object' && !Array.isArray(parsedArgs)
        ? parsedArgs
        : {};
    } catch {
      results.push({
        toolCallId: toolCall.id,
        name: toolName,
        result: {
          success: false,
          error: '参数解析失败',
        },
      });
      continue;
    }

    try {
      const result = await LookAtUserTool.execute(args as { reason: string }, context);
      results.push({
        toolCallId: toolCall.id,
        name: toolName,
        result,
      });
    } catch (error) {
      results.push({
        toolCallId: toolCall.id,
        name: toolName,
        result: {
          success: false,
          error: error instanceof Error ? error.message : '执行失败',
        },
      });
    }
  }

  return results;
}

async function buildCallModelMessages(params: {
  modelMessages: AIChatMessage[];
}): Promise<AIChatMessage[]> {
  return params.modelMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

async function buildLookAtUserVisionContext(params: {
  callId: string;
  aiConfig: CallAIConfig;
}): Promise<string | ContentPart[] | null> {
  const snapshot = await buildLatestSnapshotData(params.callId);
  if (!snapshot) {
    return null;
  }

  const imageInput = await getCallRuntimeDependencies().resolveImageModelInput({
    assistantId: params.aiConfig.id,
    imageUri: snapshot.localUri,
    mimeType: snapshot.mimeType,
    contextText: [
      '这是你刚刚通过 lookAtUser 请求获得的用户当前画面。',
      '只依据本轮实际收到的图片或 OCR 文本回应，不得使用旧画面猜测。',
    ].join('\n'),
  });
  if (imageInput.route === 'ocr') {
    const ocrText = imageInput.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('\n');
    await getCallRuntimeDependencies().repositories.calls.appendEvent({
      callId: params.callId,
      chatSessionId: snapshot.chatSessionId,
      kind: 'ocrText',
      actorType: 'model',
      actorId: params.aiConfig.id,
      text: ocrText,
      attachmentId: snapshot.attachmentId,
      visibleInChat: false,
      includeInAIContext: true,
      payloadJson: JSON.stringify({
        route: imageInput.route,
        success: imageInput.ocrSucceeded === true,
      }),
    });
  }
  return imageInput.parts;
}

async function buildLatestSnapshotData(callId: string): Promise<{
  attachmentId: string;
  chatSessionId: string;
  localUri: string;
  mimeType: string | null;
} | null> {
  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(callId);
  if (!call) {
    return null;
  }

  const cameraState = await resolveLatestCameraState(callId);
  if (cameraState && !cameraState.enabled) {
    return null;
  }

  const attachments = await getCallRuntimeDependencies().repositories.calls.listAttachments(callId);
  const latestSnapshot = attachments.find(
    (attachment) =>
      attachment.kind === 'snapshot'
      && Boolean(attachment.localUri)
      && (!cameraState || attachment.createdAt >= cameraState.createdAt)
  );
  if (!latestSnapshot?.localUri) {
    return null;
  }

  return {
    attachmentId: latestSnapshot.id,
    chatSessionId: call.chatSessionId,
    localUri: latestSnapshot.localUri,
    mimeType: latestSnapshot.mimeType || null,
  };
}

async function resolveLatestCameraState(callId: string): Promise<{
  enabled: boolean;
  facing: 'front' | 'back';
  createdAt: string;
} | null> {
  const events = await getCallRuntimeDependencies().repositories.calls.listEvents({ callId, limit: 100 });
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const payload = parseJsonObject(event.payloadJson);
    if (payload?.type !== 'cameraState') {
      continue;
    }

    return {
      enabled: payload.enabled === true,
      facing: payload.facing === 'back' ? 'back' : 'front',
      createdAt: event.createdAt,
    };
  }

  return null;
}

function parseJsonObject(rawText?: string | null): Record<string, unknown> | null {
  if (!rawText) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawText);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
