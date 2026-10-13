/** 维护通话会话生命周期，并协调通知、消息时间线与 AI 决策。 */

import { discardCallSnapshots } from '../snapshots/CallSnapshotLifetime';

import type { ChatMessage } from '@features/chat';
import { throwIfAbortSignalAborted } from '@shared/runtime/abortSignal';
import type {
  CallDirection,
  CallEndReason,
  CallSession,
  CallState,
} from '../../domain/CallSession';
import type { ICallRepository } from '../../domain/CallRepository';
import type { CallAIConfig } from '../../domain/CallAIConfig';
import {
  dismissAIIncomingCallNotification,
  sendAIIncomingCallNotification,
} from '@platform/device';
import { saveCallStatusMessage } from '../events/CreateCallStatusMessage';
import { runCallPreflight } from './CallPreflight';
import { requestOutgoingCallDecision } from './OutgoingCallDecision';
import { completeHostedCallExecution, refreshHostedCallMedia } from './CallMediaRuntimeRegistry';
import { CallFailureRecorder } from './CallFailureRecorder';
import { createCallAssistantTextMessage } from './CallMessageWriter';
import { computeCallDurationSeconds, createCallId } from './CallRuntimeHelpers';
import { cancelCallReplyRun } from './CallReplyRunState';
import { callTTSPlaybackQueue } from './CallTTSPlaybackQueue';
import { finishCallMediaSession } from './CallMediaSession';
import {
  getCallRuntimeDependencies,
  type CallChatWritePort,
} from './CallRuntimeDependencies';
import type {
  CallPreflightOptions,
  CallPreflightResult,
  IncomingCallRequest,
  MutateIncomingCallResult,
  RequestIncomingCallResult,
  StartOutgoingCallParams,
  StartOutgoingCallResult,
} from './CallRuntimeTypes';

export type {
  AIOutgoingCallDecision,
  CallPreflightOptions,
  CallPreflightResult,
  IncomingCallRequest,
  MutateIncomingCallResult,
  RequestIncomingCallResult,
  StartOutgoingCallParams,
  StartOutgoingCallResult,
} from './CallRuntimeTypes';

/** AI 来电响铃窗口：超时未接听按 missedByUser 收口；冷启动恢复按同一窗口判定，不产生第二套时长语义。 */
export const INCOMING_CALL_RINGING_TIMEOUT_MS = 30_000;

interface AICallRuntimeServiceDeps {
  callRepo?: ICallRepository;
  chat?: CallChatWritePort;
}

export class AICallRuntimeService {
  private readonly callRepoOverride?: ICallRepository;
  private readonly chatOverride?: CallChatWritePort;
  private readonly failureRecorder: CallFailureRecorder;
  private readonly incomingMissedTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly outgoingDecisions = new Map<string, AbortController>();

  constructor(deps: AICallRuntimeServiceDeps = {}) {
    this.callRepoOverride = deps.callRepo;
    this.chatOverride = deps.chat;
    this.failureRecorder = new CallFailureRecorder(
      () => this.getCallRepository(),
      () => this.getChat(),
    );
  }

  private getCallRepository(): ICallRepository {
    return this.callRepoOverride ?? getCallRuntimeDependencies().repositories.calls;
  }

  private getChat(): CallChatWritePort {
    return this.chatOverride ?? getCallRuntimeDependencies().chat;
  }

  async preflightCall(
    aiConfig: CallAIConfig,
    direction: CallDirection,
    options: CallPreflightOptions = {}
  ): Promise<CallPreflightResult> {
    return runCallPreflight(this.getCallRepository(), aiConfig, direction, options);
  }

  async requestIncomingCall(params: {
    chatSessionId: string;
    aiConfig: CallAIConfig;
    payload: IncomingCallRequest;
    abortSignal?: AbortSignal;
  }): Promise<RequestIncomingCallResult> {
    const requestedMode = params.payload.expectedMode || 'video';
    const preflight = await this.preflightCall(params.aiConfig, 'incoming', {
      requiresNotification: true,
    });

    if (!preflight.ok) {
      throwIfAbortSignalAborted(params.abortSignal);
      console.warn('[AICallRuntime] incoming call preflight failed', {
        chatSessionId: params.chatSessionId,
        aiId: params.aiConfig.id,
        endReason: preflight.endReason,
        errorMessage: preflight.errorMessage,
      });
      const failed = await this.failureRecorder.createFailedIncomingCall({
        chatSessionId: params.chatSessionId,
        aiConfig: params.aiConfig,
        payload: params.payload,
        requestedMode,
        errorMessage: preflight.errorMessage || 'AI 来电链路未接通',
        endReason: preflight.endReason || 'preflightFailed',
      });

      return {
        status: 'failed',
        call: failed.call,
        errorMessage: failed.errorMessage,
        visibleMessages: failed.visibleMessages,
      };
    }

    // 来电业务事实的唯一提交点在 createSession；预检完成后重新读取同一执行信号，
    // 已取消的 Legacy Tool 不得再创建 ringing 会话。提交之后必须继续完成事件、通知
    // 与 missed timeout 收口，避免留下半成品生命周期。
    throwIfAbortSignalAborted(params.abortSignal);
    const now = new Date().toISOString();
    const call = await this.getCallRepository().createSessionIfIdle({
      id: createCallId(),
      chatSessionId: params.chatSessionId,
      aiAssistantId: params.aiConfig.id,
      agentId: params.aiConfig.agentId,
      direction: 'incoming',
      state: 'ringing',
      requestedMode,
      activeMode: requestedMode,
      source: params.payload.source || 'aiTool',
      sourceToolCallId: params.payload.sourceToolCallId || null,
      openingLine: params.payload.openingLine,
      reason: params.payload.reason,
      startedAt: now,
    });

    if (!call) {
      return { status: 'failed', call: null, errorMessage: '当前已有通话正在进行', visibleMessages: [] };
    }

    await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId: params.chatSessionId,
      kind: 'stateChanged',
      actorType: 'ai',
      actorId: params.aiConfig.agentId,
      text: 'AI 发起视频电话，正在等待用户接听。',
      payloadJson: JSON.stringify({
        to: 'ringing',
        direction: 'incoming',
        urgency: params.payload.urgency,
        reason: params.payload.reason,
      }),
    });

    const visibleMessages: ChatMessage[] = [];

    const notificationSent = await sendAIIncomingCallNotification({
      callId: call.id,
      aiId: params.aiConfig.id,
      aiName: params.aiConfig.name,
      aiAvatar: params.aiConfig.avatar || null,
      sessionId: params.chatSessionId,
      openingLine: params.payload.openingLine,
      reason: params.payload.reason,
    });

    if (!notificationSent) {
      console.warn('[AICallRuntime] incoming call notification failed', {
        callId: call.id,
        chatSessionId: params.chatSessionId,
      });
      const failed = await this.failureRecorder.failExistingIncomingCall({
        call,
        errorMessage: '系统通知发送失败，无法显示 AI 来电提示',
        endReason: 'permissionDenied',
      });

      return {
        status: 'failed',
        call: failed.call,
        errorMessage: failed.errorMessage,
        visibleMessages: [
          ...visibleMessages,
          ...failed.visibleMessages,
        ],
      };
    }

    this.scheduleIncomingMissedTimeout(call.id);

    return {
      status: 'ringing',
      call,
      visibleMessages,
    };
  }

  async acceptCall(callId: string): Promise<MutateIncomingCallResult> {
    this.clearIncomingMissedTimeout(callId);
    await dismissAIIncomingCallNotification(callId);

    const call = await this.getCallRepository().getSessionById(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }
    if (call.state !== 'ringing' && call.state !== 'requested') {
      return {
        call,
        visibleMessages: [],
      };
    }

    const now = new Date().toISOString();
    const activeCall = await this.getCallRepository().updateSessionIfState(call.id, ['ringing', 'requested'], {
      state: 'active',
      acceptedAt: now,
    });
    if (!activeCall) {
      const current = await this.getCallRepository().getSessionById(call.id);
      if (!current) throw new Error(`Call ${call.id} disappeared while accepting`);
      return { call: current, visibleMessages: [] };
    }
    await this.beginAudioSession(activeCall);
    await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId: call.chatSessionId,
      kind: 'stateChanged',
      actorType: 'user',
      text: '用户接听了 AI 发起的视频电话。',
      payloadJson: JSON.stringify({
        to: 'active',
        endReason: null,
      }),
    });

    const visibleMessages = [
      await saveCallStatusMessage(this.getChat(), {
        sessionId: call.chatSessionId,
        callId: call.id,
        direction: call.direction,
        callStatus: 'callStarted',
        actor: 'user',
        agentId: call.agentId,
        // 用户已接听并进入通话，状态消息直接已读。
        isRead: true,
      }),
    ];

    const openingLine = String(call.openingLine || '').trim();
    if (openingLine) {
      await this.getCallRepository().appendEvent({
        callId: call.id,
        chatSessionId: call.chatSessionId,
        kind: 'aiSpeechText',
        actorType: 'ai',
        actorId: call.agentId,
        text: openingLine,
        visibleInChat: false,
        includeInAIContext: true,
      });
      // 开场白必须真实进 TTS 播放队列；字幕经 subscribeCallSentencePlayback 推送，双工保护跟随播放事件。
      // 只播一次由状态机保证：ringing/requested→active 只会发生一次，刷新/重挂载/轮询不会重播。
      void callTTSPlaybackQueue.enqueueAISpeech({
        callId: call.id,
        assistantId: call.aiAssistantId,
        text: openingLine,
      }).catch((error) => {
        console.warn('[AICallRuntimeService] Failed to enqueue opening line playback:', error);
      });
    }

    return {
      call: activeCall,
      visibleMessages,
    };
  }

  async rejectCall(
    callId: string,
    reason: CallEndReason = 'userRejected'
  ): Promise<MutateIncomingCallResult> {
    this.clearIncomingMissedTimeout(callId);
    await dismissAIIncomingCallNotification(callId);

    const call = await this.getCallRepository().getSessionById(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }
    if (call.state !== 'ringing' && call.state !== 'requested') {
      return {
        call,
        visibleMessages: [],
      };
    }

    const now = new Date().toISOString();
    const rejectedCall = await this.getCallRepository().updateSessionIfState(call.id, ['ringing', 'requested'], {
      state: 'rejected',
      endedAt: now,
      endReason: reason,
    });
    if (!rejectedCall) {
      const current = await this.getCallRepository().getSessionById(call.id);
      if (!current) throw new Error(`Call ${call.id} disappeared while rejecting`);
      return { call: current, visibleMessages: [] };
    }
    await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId: call.chatSessionId,
      kind: 'stateChanged',
      actorType: 'user',
      text: '用户拒绝接听 AI 发起的视频电话。',
      payloadJson: JSON.stringify({
        to: 'rejected',
        endReason: reason,
      }),
    });

    const visibleMessages = [
      await saveCallStatusMessage(this.getChat(), {
        sessionId: call.chatSessionId,
        callId: call.id,
        direction: call.direction,
        callStatus: 'callRejectedByUser',
        actor: 'user',
        endReason: reason,
        agentId: call.agentId,
        // 用户主动拒接，已看到来电，状态消息直接已读。
        isRead: true,
      }),
    ];

    this.notifyCallTerminated(rejectedCall);

    return {
      call: rejectedCall,
      visibleMessages,
    };
  }

  async startOutgoingCall(params: StartOutgoingCallParams): Promise<StartOutgoingCallResult> {
    const {
      chatSessionId,
      aiConfig,
      requestedMode = 'video',
    } = params;
    const visibleMessages: ChatMessage[] = [];
    const preflight = await this.preflightCall(aiConfig, 'outgoing');

    if (!preflight.ok) {
      if (preflight.endReason === 'preflightFailed') {
        const missedCall = await this.failureRecorder.createMissedOutgoingCall({
          chatSessionId,
          aiConfig,
          requestedMode,
          errorMessage: preflight.errorMessage || '对方暂时无法接通',
          reason: 'preflightFailed',
        });

        return {
          status: 'failed',
          call: missedCall.call,
          errorMessage: missedCall.errorMessage,
          visibleMessages: missedCall.visibleMessages,
        };
      }

      return {
        status: 'failed',
        call: null,
        errorMessage: preflight.errorMessage || '对方暂时无法接通',
        visibleMessages,
      };
    }

    const claimedCall = await this.getCallRepository().createSessionIfIdle({
      id: createCallId(),
      chatSessionId,
      aiAssistantId: aiConfig.id,
      agentId: aiConfig.agentId,
      direction: 'outgoing',
      state: 'dialing',
      requestedMode,
      activeMode: requestedMode,
      source: 'user',
      startedAt: new Date().toISOString(),
    });

    if (!claimedCall) {
      return { status: 'failed', call: null, errorMessage: '当前已有通话正在进行', visibleMessages };
    }
    let call = claimedCall;

    await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId,
      kind: 'stateChanged',
      actorType: 'system',
      text: '用户向 AI 发起视频电话，正在等待 AI 接听或拒接。',
      payloadJson: JSON.stringify({
        from: null,
        to: 'dialing',
        direction: 'outgoing',
      }),
    });
    const controller = new AbortController();
    this.outgoingDecisions.set(call.id, controller);
    params.onCallCreated?.(call);

    try {
      await getCallRuntimeDependencies().native.execution.start(call);
    } catch (error) {
      this.outgoingDecisions.delete(call.id);
      if (controller.signal.aborted) return this.readEndedOutgoingCall(call.id);
      await this.endCall(call.id, 'runtimeError');
      throw error;
    }

    let decisionResult: Awaited<ReturnType<typeof requestOutgoingCallDecision>>;
    try {
      decisionResult = await requestOutgoingCallDecision({
        aiConfig, chatSessionId, callId: call.id, signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return this.readEndedOutgoingCall(call.id);
      await this.endCall(call.id, 'runtimeError');
      throw error;
    } finally {
      this.outgoingDecisions.delete(call.id);
    }
    if (decisionResult.success === false) {
      const errorMessage = decisionResult.errorMessage;
      const now = new Date().toISOString();
      const missedCall = await this.getCallRepository().updateSessionIfState(call.id, ['dialing'], {
        state: 'missed',
        endedAt: now,
        endReason: 'missedByAI',
      });
      if (!missedCall) return this.readEndedOutgoingCall(call.id);
      call = missedCall;
      try {
        await finishCallMediaSession(call);
        await this.getCallRepository().appendEvent({
          callId: call.id,
          chatSessionId,
          kind: 'error',
          actorType: 'system',
          text: errorMessage,
          includeInAIContext: true,
        });
        visibleMessages.push(await saveCallStatusMessage(this.getChat(), {
          sessionId: chatSessionId,
          callId: call.id,
          direction: 'outgoing',
          callStatus: 'callMissed',
          actor: 'system',
          endReason: 'missedByAI',
          agentId: aiConfig.agentId,
          aiContextText: `用户发起的视频电话没有接通，聊天界面显示为【对方未接听】；底层原因是 AI 接听判断链路失败：${errorMessage}`,
          // 用户主动拨出并在通话页看到未接通结果，直接已读。
          isRead: true,
        }));

        this.notifyCallTerminated(call);

        return {
          status: 'failed',
          call,
          errorMessage,
          visibleMessages,
        };
      } finally {
        completeHostedCallExecution(call.id);
      }
    }

    const decision = decisionResult.decision;
    if (decision.decision === 'reject') {
      const now = new Date().toISOString();
      const rejectionReason = decision.rejectionReason.trim() || '我现在不太方便接电话，但可以先在这里陪你说。';
      const rejectedCall = await this.getCallRepository().updateSessionIfState(call.id, ['dialing'], {
        state: 'rejected',
        endedAt: now,
        endReason: 'aiRejected',
        aiRejectionReason: rejectionReason,
      });
      if (!rejectedCall) return this.readEndedOutgoingCall(call.id);
      call = rejectedCall;
      try {
        await finishCallMediaSession(call);
        await this.getCallRepository().appendEvent({
          callId: call.id,
          chatSessionId,
          kind: 'stateChanged',
          actorType: 'ai',
          actorId: aiConfig.agentId,
          text: 'AI 拒绝接听用户发起的视频电话。',
          payloadJson: JSON.stringify({
            to: 'rejected',
            endReason: 'aiRejected',
          }),
        });
        visibleMessages.push(await saveCallStatusMessage(this.getChat(), {
          sessionId: chatSessionId,
          callId: call.id,
          direction: 'outgoing',
          callStatus: 'callRejectedByAI',
          actor: 'ai',
          endReason: 'aiRejected',
          agentId: aiConfig.agentId,
          // 用户主动拨出并在通话页看到 AI 拒接结果，直接已读。
          isRead: true,
        }));
        visibleMessages.push(await createCallAssistantTextMessage(this.getChat(), {
          sessionId: chatSessionId,
          aiConfig,
          text: rejectionReason,
          triggerReason: 'outgoing_call_rejected',
        }));

        this.notifyCallTerminated(call);

        return {
          status: 'rejected',
          call,
          rejectionReason,
          visibleMessages,
        };
      } finally {
        completeHostedCallExecution(call.id);
      }
    }

    const now = new Date().toISOString();
    const spokenText = decision.spokenText.trim() || '我接到了。';
    const connectedCall = await this.getCallRepository().updateSessionIfState(call.id, ['dialing'], {
      state: 'active',
      acceptedAt: now,
    });
    if (!connectedCall) return this.readEndedOutgoingCall(call.id);
    call = connectedCall;
    await this.beginAudioSession(call);
    visibleMessages.push(await saveCallStatusMessage(this.getChat(), {
      sessionId: chatSessionId,
      callId: call.id,
      direction: 'outgoing',
      callStatus: 'callStarted',
      actor: 'ai',
      agentId: aiConfig.agentId,
      // 用户主动拨出且通话已接通，直接已读。
      isRead: true,
    }));
    const firstEvent = await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId,
      kind: 'aiSpeechText',
      actorType: 'ai',
      actorId: aiConfig.agentId,
      text: spokenText,
      visibleInChat: false,
      includeInAIContext: true,
    });
    // 去电首句同样进 TTS 播放队列；每个会话只创建一次，天然只播一次。
    void callTTSPlaybackQueue.enqueueAISpeech({
      callId: call.id,
      assistantId: aiConfig.id,
      text: spokenText,
    }).catch((error) => {
      console.warn('[AICallRuntimeService] Failed to enqueue outgoing first speech playback:', error);
    });

    return {
      status: 'accepted',
      call,
      firstEvent,
      visibleMessages,
    };
  }

  private scheduleIncomingMissedTimeout(
    callId: string,
    delayMs: number = INCOMING_CALL_RINGING_TIMEOUT_MS
  ): void {
    this.clearIncomingMissedTimeout(callId);
    const timer = setTimeout(() => {
      this.incomingMissedTimers.delete(callId);
      this.markIncomingCallMissed(callId).catch((error) => {
        console.warn('[AICallRuntimeService] Failed to mark incoming call missed:', error);
      });
    }, delayMs);
    this.incomingMissedTimers.set(callId, timer);
  }

  /**
   * 冷启动恢复：为仍在响铃窗口内的 incoming ringing 重建剩余 missed timeout。
   * 返回 false 表示窗口已过期，调用方应直接按 missedByUser 收口。
   */
  restoreIncomingMissedTimeout(call: CallSession): boolean {
    const ringingStartedAtMs = call.startedAt ? Date.parse(call.startedAt) : NaN;
    const remainingMs = Number.isNaN(ringingStartedAtMs)
      ? 0
      : INCOMING_CALL_RINGING_TIMEOUT_MS - (Date.now() - ringingStartedAtMs);
    if (remainingMs <= 0) {
      return false;
    }
    this.scheduleIncomingMissedTimeout(call.id, remainingMs);
    return true;
  }

  private clearIncomingMissedTimeout(callId: string): void {
    const timer = this.incomingMissedTimers.get(callId);
    if (timer) {
      clearTimeout(timer);
      this.incomingMissedTimers.delete(callId);
    }
  }

  async markIncomingCallMissed(callId: string): Promise<MutateIncomingCallResult | null> {
    const call = await this.getCallRepository().getSessionById(callId);
    if (!call || call.direction !== 'incoming' || (call.state !== 'ringing' && call.state !== 'requested')) {
      return null;
    }

    this.clearIncomingMissedTimeout(callId);
    await dismissAIIncomingCallNotification(callId);

    const now = new Date().toISOString();
    const missedCall = await this.getCallRepository().updateSessionIfState(call.id, ['ringing', 'requested'], {
      state: 'missed',
      endedAt: now,
      endReason: 'missedByUser',
    });
    if (!missedCall) return null;
    await this.getCallRepository().appendEvent({
      callId: call.id,
      chatSessionId: call.chatSessionId,
      kind: 'stateChanged',
      actorType: 'system',
      text: 'AI 发起的视频电话 30 秒内未被用户接听，已标记为未应答。',
      payloadJson: JSON.stringify({
        to: 'missed',
        endReason: 'missedByUser',
        timeoutMs: INCOMING_CALL_RINGING_TIMEOUT_MS,
      }),
    });

    const visibleMessages = [
      await saveCallStatusMessage(this.getChat(), {
        sessionId: call.chatSessionId,
        callId: call.id,
        direction: call.direction,
        callStatus: 'callMissed',
        actor: 'system',
        endReason: 'missedByUser',
        agentId: call.agentId,
        // 未接来电：用户没有看到/响应，保留未读以提醒。
        isRead: false,
      }),
    ];

    this.notifyCallTerminated(missedCall);

    return {
      call: missedCall,
      visibleMessages,
    };
  }

  async endCall(
    callId: string,
    reason: CallEndReason = 'userEnded'
  ): Promise<{ call: CallSession; visibleMessages: ChatMessage[] }> {
    cancelCallReplyRun(callId);
    await callTTSPlaybackQueue.stopCallPlayback(callId);
    this.clearIncomingMissedTimeout(callId);
    await dismissAIIncomingCallNotification(callId);

    const call = await this.getCallRepository().getSessionById(callId);
    if (!call) {
      throw new Error(`Call ${callId} not found`);
    }

    const now = new Date().toISOString();
    const endableStates: [CallState, ...CallState[]] = [
      'requested',
      'ringing',
      'dialing',
      'connecting',
      'active',
      'ending',
    ];
    const endedCall = await this.getCallRepository().updateSessionIfState(call.id, endableStates, {
      state: 'ended',
      endedAt: now,
      endReason: reason,
    });
    if (!endedCall) {
      const terminalCall = await this.getCallRepository().getSessionById(call.id);
      if (!terminalCall) {
        throw new Error(`Call ${call.id} disappeared while ending`);
      }
      // 终态可能由启动恢复或另一入口提交；挂断仍须释放媒体并结束执行任务。
      // 重复动作只补齐资源释放，不重写结束原因、状态气泡或终态跟进。
      try {
        await finishCallMediaSession(terminalCall);
      } finally {
        completeHostedCallExecution(call.id);
      }
      return {
        call: terminalCall,
        visibleMessages: [],
      };
    }
    // 终态先提交，再 abort 去电决策，取消消费者回读时不会看到仍在拨号的旧事实。
    this.outgoingDecisions.get(call.id)?.abort();
    try {
      await finishCallMediaSession(endedCall);
      await this.getCallRepository().appendEvent({
        callId: call.id,
        chatSessionId: call.chatSessionId,
        kind: 'stateChanged',
        actorType: reason === 'aiEnded' ? 'ai' : 'user',
        actorId: reason === 'aiEnded' ? call.agentId : null,
        text: reason === 'aiEnded'
          ? 'AI 主动挂断了视频电话。'
          : '用户主动挂断了视频电话。',
        payloadJson: JSON.stringify({
          to: 'ended',
          endReason: reason,
        }),
      });

      const durationSeconds = computeCallDurationSeconds(endedCall);
      const statusActor = endedCall.acceptedAt ? 'system' : (reason === 'aiEnded' ? 'ai' : 'user');
      const visibleMessages = [
        await saveCallStatusMessage(this.getChat(), {
          sessionId: call.chatSessionId,
          callId: call.id,
          direction: call.direction,
          callStatus: endedCall.acceptedAt ? 'callDuration' : 'callEnded',
          actor: statusActor,
          endReason: reason,
          durationSeconds: endedCall.acceptedAt ? durationSeconds : null,
          agentId: call.agentId,
          // 已接通（含最终时长记录）、用户拨出、用户主动挂断：用户真实参与/看到，已读；
          // 仅“来电未接通且 AI 先挂断”等同未接，保留未读。
          isRead: Boolean(endedCall.acceptedAt)
            || call.direction === 'outgoing'
            || reason === 'userEnded',
        }),
      ];

      this.notifyCallTerminated(endedCall);

      return {
        call: endedCall,
        visibleMessages,
      };
    } finally {
      completeHostedCallExecution(call.id);
    }
  }

  private async beginAudioSession(call: CallSession): Promise<void> {
    try {
      await getCallRuntimeDependencies().native.execution.start(call);
      await getCallRuntimeDependencies().native.audioPlayback.beginSession(call.id);
      await refreshHostedCallMedia(call.id);
    } catch (error) {
      // 外部音频资源获取失败时收口已经提交的 active，不留下无法工作的通话。
      await this.endCall(call.id, 'runtimeError');
      throw error;
    }
  }

  private async readEndedOutgoingCall(callId: string): Promise<StartOutgoingCallResult> {
    const call = await this.getCallRepository().getSessionById(callId);
    if (!call) throw new Error(`Call ${callId} disappeared while deciding`);
    return { status: 'ended', call, visibleMessages: [] };
  }

  private notifyCallTerminated(call: CallSession): void {
    completeHostedCallExecution(call.id);
    void discardCallSnapshots(call.id);
    const listener = getCallRuntimeDependencies().onCallTerminated;
    if (!listener) {
      return;
    }

    // 通话界面不等待后续 AI 生成；终态事实已经落库，Host 可在后台继续消费。
    void Promise.resolve().then(() => listener(call)).catch((error) => {
      console.warn('[AICallRuntimeService] terminal call listener failed', {
        callId: call.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }


}

export const aiCallRuntimeService = new AICallRuntimeService();
