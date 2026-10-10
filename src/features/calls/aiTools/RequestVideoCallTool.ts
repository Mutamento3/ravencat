/** 请求系统发起 AI 视频来电的工具。 */

import { requestIncomingCall } from '../application/lifecycle';
import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import type { CallAIConfig } from '../domain/CallAIConfig';

interface RequestVideoCallArgs {
  reason: string;
  urgency: 'low' | 'normal' | 'high';
  openingLine: string;
  expectedMode: 'voice' | 'video';
}

export const definition = {
  name: 'requestVideoCall',
  description: [
    '向用户发起一次 AI 视频来电邀请。',
    '你可以根据自己的性格、你和用户的关系以及当下情境主动来电，不必等用户先提出，也不必先发消息征求许可；来电本身就是邀请，用户可以自由接听或拒绝。',
    '当你真心想和用户实时聊聊、陪伴用户、分享当下，或者觉得通话比继续打字更自然时，可以调用；用户明确要求打电话时优先使用。',
    '如果来电仍在等待接听、通话正在进行，无需再次调用。',
    '同一轮最多调用一次；请求提交成功只表示正在等待用户接听，不要声称电话已经接通。',
  ].join(''),
  parameters: {
    type: 'object' as const,
    properties: {
      reason: { type: 'string' as const, description: '你为什么想发起这通电话' },
      urgency: {
        type: 'string' as const,
        enum: ['low', 'normal', 'high'],
        description: '来电紧急程度',
      },
      openingLine: { type: 'string' as const, description: '用户接听后你在电话里的第一句话；使用纯口语，可含自然语气词和标点停顿，不含厂商控制标记。接通后的实时回复另有当前语音模型说明' },
      expectedMode: {
        type: 'string' as const,
        enum: ['voice', 'video'],
        description: '期望通话模式',
      },
    },
    required: ['reason', 'urgency', 'openingLine', 'expectedMode'],
    additionalProperties: false,
  },
};

export async function execute(
  args: RequestVideoCallArgs,
  context: ToolContext
) {
  const reason = String(args.reason || '').trim();
  const openingLine = String(args.openingLine || '').trim();
  const urgency = args.urgency === 'low' || args.urgency === 'high' ? args.urgency : 'normal';
  const expectedMode = args.expectedMode === 'voice' ? 'voice' : 'video';

  if (!reason) {
    return { success: false, error: '缺少来电原因' };
  }

  if (!openingLine) {
    return { success: false, error: '缺少接听后的开场白' };
  }

  if (context.isBlocked()) {
    return { success: false, error: '当前 AI 已被拉黑，不能发起视频电话' };
  }

  if (!context.sessionId) {
    return { success: false, error: '当前 Agent run 没有关联真实聊天会话，不能发起视频电话' };
  }

  throwIfAbortSignalAborted(context.abortSignal);

  if (context.sharedState.requestVideoCallSubmitted) {
    return {
      success: true,
      message: '本轮已经提交过一次视频电话请求。',
      data: { skippedDuplicate: true },
    };
  }

  context.sharedState.requestVideoCallSubmitted = true;

  const result = await requestIncomingCall({
    chatSessionId: context.sessionId,
    aiConfig: context.aiConfig as CallAIConfig,
    abortSignal: context.abortSignal,
    payload: {
      reason,
      urgency,
      openingLine,
      expectedMode,
    },
  });

  if (result.status === 'failed') {
    return {
      success: false,
      error: result.errorMessage,
      data: {
        callId: result.call?.id || null,
      },
    };
  }

  context.notifyUI(context.sessionId);

  return {
    success: true,
    message: '视频电话请求已提交。',
    suppressAssistantReply: true,
    data: {
      callId: result.call.id,
      status: result.status,
    },
  };
}

export const RequestVideoCallTool = {
  name: definition.name,
  definition,
  execute,
};
