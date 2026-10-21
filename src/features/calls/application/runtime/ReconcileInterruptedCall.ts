/** 在显式冷启动恢复阶段收口上一次进程遗留的非终态通话。 */

import { discardPreviousProcessCallSnapshots } from '../snapshots/CallSnapshotLifetime';
import type { CallSession, CallState } from '../../domain/CallSession';
import { saveCallStatusMessage } from '../events/CreateCallStatusMessage';
import { aiCallRuntimeService } from './AICallRuntimeService';
import { getCallRuntimeDependencies } from './CallRuntimeDependencies';

const INTERRUPTIBLE_CALL_STATES: [CallState, ...CallState[]] = [
  'requested',
  'ringing',
  'dialing',
  'connecting',
  'active',
  'ending',
];

/**
 * 仅由冷启动恢复入口显式调用；普通 AppState 前后台切换不得调用此函数。
 *
 * 状态语义（2026-08 修订）：
 * - incoming ringing/requested 不是进程故障：系统来电通知/来电壳仍在等待用户响应，
 *   且原生层可能已持久化 pending accept。仍在响铃窗口内的重建剩余 missed timeout
 *   （保护后续 accept 进入现有 acceptCall()）；已过期的复用正常未接路径按 missedByUser 收口。
 * - 页面重建不等于进程终止；原生执行宿主仍存活时，保留当前通话与快照。
 * - 其余没有存活执行宿主的非终态按 runtimeError 收口。
 *
 * CAS 失败表示另一个生命周期已先完成终态转换，本次不再重复写入事实。
 */
export async function reconcileInterruptedCallFromPreviousProcess(): Promise<CallSession | null> {
  const runtime = getCallRuntimeDependencies();
  const activeCall = await aiCallRuntimeService.restoreActiveCallSnapshot();
  if (activeCall && await runtime.native.execution.isAlive(activeCall.id)) {
    return null;
  }
  await discardPreviousProcessCallSnapshots();
  if (!activeCall) {
    return null;
  }

  if (
    activeCall.direction === 'incoming'
    && (activeCall.state === 'ringing' || activeCall.state === 'requested')
  ) {
    const restored = aiCallRuntimeService.restoreIncomingMissedTimeout(activeCall);
    if (!restored) {
      await aiCallRuntimeService.markIncomingCallMissed(activeCall.id);
    }
    // incoming ringing 恢复/收口都不是“系统故障中断”，不需要 Host 导航纠偏。
    return null;
  }

  const endedAt = new Date().toISOString();
  const interruptedCall = await runtime.repositories.calls.updateSessionIfState(
    activeCall.id,
    INTERRUPTIBLE_CALL_STATES,
    {
      state: 'failed',
      endedAt,
      endReason: 'runtimeError',
    }
  );
  if (!interruptedCall) {
    return null;
  }
  aiCallRuntimeService.clearActiveCallSnapshot(interruptedCall.id);

  await runtime.repositories.calls.appendEvent({
    callId: interruptedCall.id,
    chatSessionId: interruptedCall.chatSessionId,
    kind: 'stateChanged',
    actorType: 'system',
    text: '通话因系统故障中断。',
    visibleInChat: false,
    includeInAIContext: true,
    payloadJson: JSON.stringify({
      from: activeCall.state,
      to: 'failed',
      endReason: 'runtimeError',
      recovery: 'previous_process_termination',
    }),
  });

  await saveCallStatusMessage(runtime.chat, {
    sessionId: interruptedCall.chatSessionId,
    callId: interruptedCall.id,
    direction: interruptedCall.direction,
    callStatus: 'callSystemError',
    actor: 'system',
    endReason: 'runtimeError',
    displayText: '【通话因系统故障中断】',
    aiContextText: '通话因系统故障中断，聊天界面显示为【通话因系统故障中断】。',
    agentId: interruptedCall.agentId,
    isRead: Boolean(interruptedCall.acceptedAt) || interruptedCall.direction === 'outgoing',
  });

  return interruptedCall;
}
