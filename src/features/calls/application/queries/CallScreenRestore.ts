import type { CallSession } from '../../domain/CallSession';
import { isCallTerminalState } from '../runtime/CallRuntimeHelpers';

/**
 * RN CallScreen 恢复与路由准入语义，Calls 层唯一判定；Host 不得自行枚举通话状态。
 * 终态已经失去媒体执行期，旧地址不能再次进入等待 runtime 的页面。
 *
 * incoming 的 requested/ringing 期间，CallStyle 通知与原生 IncomingCallActivity
 * 是唯一来电 surface，恢复时不得自动打开 RN 通话页，否则与原生来电页形成
 * 双 incoming surface / 双接听。只有 acceptCall() 使状态进入 active 后，
 * 才恢复现有 RN active call screen；outgoing 拨号流程维持原有恢复行为。
 */
export function shouldRestoreCallScreen(call: CallSession): boolean {
  return !isCallTerminalState(call.state) && !(
    call.direction === 'incoming'
    && (call.state === 'requested' || call.state === 'ringing')
  );
}
