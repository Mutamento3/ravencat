/** 通话中请求查看用户当前画面的 AI 工具。 */

import { requestCallSnapshotFromProvider } from '../application/snapshots/CallSnapshotProviderRegistry';
import { getCallRuntimeDependencies } from '../application/runtime/CallRuntimeDependencies';
import type { ToolContext } from '@shared/aiTools';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';

interface LookAtUserArgs {
  reason: string;
}

export const definition = {
  name: 'lookAtUser',
  description: [
    '在当前视频通话中按需看一眼用户此刻的画面；你不会持续接收摄像头视频。',
    '用户让你看、视觉细节与谈话有关，或短暂看看用户及周围环境能让实时交流更自然时可以调用。',
    '只有本轮调用成功且系统实际提供图片或 OCR 结果后，才代表你看到了当前画面；摄像头开启本身不代表你已经看见。',
    '不要在没有新理由时连续调用。',
  ].join(''),
  parameters: {
    type: 'object' as const,
    properties: {
      reason: { type: 'string' as const, description: '你为什么需要看用户当前画面' },
    },
    required: ['reason'],
    additionalProperties: false,
  },
};

export async function execute(
  args: LookAtUserArgs,
  context: ToolContext
) {
  const reason = String(args.reason || '').trim();
  if (!reason) {
    return { success: false, error: '缺少查看画面的原因' };
  }

  const callId = context.getRelatedEntityType() === 'call'
    ? context.getRelatedEntityId()
    : null;
  if (!callId) {
    return { success: false, error: 'lookAtUser 只能在视频通话中使用' };
  }

  const call = await getCallRuntimeDependencies().repositories.calls.getSessionById(callId);
  if (!call || call.state !== 'active') {
    return { success: false, error: '当前没有接通中的视频通话' };
  }

  throwIfAbortSignalAborted(context.abortSignal);
  await getCallRuntimeDependencies().repositories.calls.appendEvent({
    callId: call.id,
    chatSessionId: call.chatSessionId,
    kind: 'lookAtUserRequested',
    actorType: 'ai',
    actorId: context.getAIId() || null,
    text: `AI 请求查看用户当前画面：${reason}`,
    visibleInChat: false,
    includeInAIContext: true,
    payloadJson: JSON.stringify({ reason }),
  });

  throwIfAbortSignalAborted(context.abortSignal);
  const snapshotResult = await requestCallSnapshotFromProvider(call.id, 'look_at_user');
  if (snapshotResult.status !== 'captured') {
    return {
      success: true,
      message: snapshotResult.status === 'camera_disabled' ? '摄像头未开启' : snapshotResult.message,
      data: {
        status: snapshotResult.status,
      },
    };
  }

  return {
    success: true,
    message: '已截取用户当前画面，系统会按当前视觉路由把可用结果作为隐藏通话上下文提供。',
    data: {
      status: 'captured',
      attachmentId: snapshotResult.result.attachment.id,
      eventId: snapshotResult.result.event.id,
    },
  };
}

export const LookAtUserTool = {
  name: definition.name,
  definition,
  execute,
};
