/**
 * 通话生命周期用例的 application 层门面。
 * 状态流转的唯一 owner 是 AICallRuntimeService；这里只做稳定函数出口，
 * 避免 feature 公共 API 直接暴露内部 runtime 单例。
 */

import type { CallAIConfig } from '../domain/CallAIConfig';
import type { CallDirection, CallEndReason } from '../domain/CallSession';
import {
  aiCallRuntimeService,
  type CallPreflightOptions,
  type CallPreflightResult,
  type IncomingCallRequest,
  type MutateIncomingCallResult,
  type RequestIncomingCallResult,
  type StartOutgoingCallParams,
  type StartOutgoingCallResult,
} from './runtime/AICallRuntimeService';

export function preflightCall(
  aiConfig: CallAIConfig,
  direction: CallDirection,
  options: CallPreflightOptions = {}
): Promise<CallPreflightResult> {
  return aiCallRuntimeService.preflightCall(aiConfig, direction, options);
}

export function startOutgoingCall(
  params: StartOutgoingCallParams
): Promise<StartOutgoingCallResult> {
  return aiCallRuntimeService.startOutgoingCall(params);
}

export function endCall(callId: string, reason: CallEndReason = 'userEnded') {
  return aiCallRuntimeService.endCall(callId, reason);
}

export function requestIncomingCall(params: {
  chatSessionId: string;
  aiConfig: CallAIConfig;
  payload: IncomingCallRequest;
  abortSignal?: AbortSignal;
}): Promise<RequestIncomingCallResult> {
  return aiCallRuntimeService.requestIncomingCall(params);
}

export function acceptCall(callId: string): Promise<MutateIncomingCallResult> {
  return aiCallRuntimeService.acceptCall(callId);
}

export function rejectCall(
  callId: string,
  reason: CallEndReason = 'userRejected'
): Promise<MutateIncomingCallResult> {
  return aiCallRuntimeService.rejectCall(callId, reason);
}

export function markIncomingCallMissed(callId: string): Promise<MutateIncomingCallResult | null> {
  return aiCallRuntimeService.markIncomingCallMissed(callId);
}
