/** Soft Lock 业务锁提交后，Device Control application 对当前原生执行事实的稳定投影。 */

import type {
  DeviceControlReconcileResult,
  DeviceControlRuntimeStartResult,
  DeviceControlRuntimeState,
} from './DeviceControlPort';

export type SoftLockExecutionState =
  | 'blocking_now'
  | 'waiting_for_target'
  | 'activated_but_not_executing';

export type SoftLockExecutionIssue =
  | 'background_start_restricted'
  | 'runtime_unavailable'
  | 'overlay_permission_missing'
  | 'observer_unavailable'
  | 'window_unreliable'
  | 'reconcile_failed'
  | 'overlay_add_failed'
  | 'execution_failed';

export type SoftLockExecutionTruth =
  | { state: 'blocking_now' }
  | { state: 'waiting_for_target' }
  | {
      state: 'activated_but_not_executing';
      issue: SoftLockExecutionIssue;
    };

export interface ResolveSoftLockExecutionTruthInput {
  lockId: string;
  targetPackage: string;
  start: DeviceControlRuntimeStartResult;
  reconcile: DeviceControlReconcileResult | null;
  runtimeState: DeviceControlRuntimeState;
}

/**
 * 原生 DTO 在 application 边界被翻译为窄的 Soft Lock 执行契约。
 * business active 由调用方保证；这里不从执行失败反推 release，也不从 reconcile ok 推断窗口已挂载。
 */
export function resolveSoftLockExecutionTruth(
  input: ResolveSoftLockExecutionTruthInput,
): SoftLockExecutionTruth {
  const { lockId, targetPackage, start, reconcile, runtimeState } = input;

  if (start.status === 'background_start_restricted') {
    return notExecuting('background_start_restricted');
  }
  if (
    runtimeState.diagnostics.lastFailure?.code
    === 'background_start_restricted'
  ) {
    return notExecuting('background_start_restricted');
  }
  if (start.status === 'failed') {
    return notExecuting('execution_failed');
  }
  if (
    !runtimeState.runtimeAttached
    || reconcile?.status === 'runtime_unavailable'
  ) {
    return notExecuting('runtime_unavailable');
  }
  if (reconcile?.status === 'failed') {
    return notExecuting('reconcile_failed');
  }
  if (reconcile?.status !== 'ok') {
    return notExecuting('execution_failed');
  }
  if (runtimeState.overlayStatus === 'permission_missing') {
    return notExecuting('overlay_permission_missing');
  }
  if (!runtimeState.observerConnected || runtimeState.currentWindow === null) {
    return notExecuting('observer_unavailable');
  }
  if (
    !runtimeState.currentWindow.detectionReliable
    || !runtimeState.currentWindow.packageName
  ) {
    return notExecuting('window_unreliable');
  }
  if (runtimeState.overlayStatus === 'add_failed') {
    return notExecuting('overlay_add_failed');
  }
  if (runtimeState.overlayStatus === 'remove_failed') {
    return notExecuting('execution_failed');
  }

  const projectedLock = runtimeState.projectedLocks.find(({ id }) => id === lockId);
  if (!projectedLock || projectedLock.targetPackage !== targetPackage) {
    return notExecuting('execution_failed');
  }

  const matchingLock = runtimeState.matchingLockId === null
    ? null
    : runtimeState.projectedLocks.find(({ id }) => id === runtimeState.matchingLockId) ?? null;
  if (
    runtimeState.currentWindow.packageName === targetPackage
    && matchingLock?.targetPackage === targetPackage
    && runtimeState.targetMatched
    && runtimeState.shouldBlock
    && runtimeState.attached
    && runtimeState.attachedLockId === runtimeState.matchingLockId
    && runtimeState.overlayStatus === 'attached'
  ) {
    return { state: 'blocking_now' };
  }

  // native 的 targetMatched/shouldBlock 面向全部投影；若另一个 target 正在被阻断，
  // 当前业务锁的 target 仍然只是等待进入前台，不能把另一条锁的窗口误算给它。
  if (
    runtimeState.currentWindow.packageName !== targetPackage
    && runtimeState.attachedLockId !== lockId
    && matchingLock?.targetPackage !== targetPackage
  ) {
    return { state: 'waiting_for_target' };
  }

  return notExecuting('execution_failed');
}

function notExecuting(issue: SoftLockExecutionIssue): SoftLockExecutionTruth {
  return { state: 'activated_but_not_executing', issue };
}
