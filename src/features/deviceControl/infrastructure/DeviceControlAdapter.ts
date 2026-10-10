/**
 * Device Control 原生执行端口的真实 bridge 适配器。
 *
 * 只把 application 已提交的业务真值投影同步给 modules/device-control；
 * native 返回的 typed failure 原样上报，不改写业务状态，不伪造执行成功。
 * ok 仅代表投影被 native runtime 接受；实际 blocking window 状态由
 * getDeviceControlRuntimeState 单独返回，绝不从 command success 反推 attached。
 */

import {
  dispatchBrowsableUri,
  getDeviceControlRuntimeState,
  openApp,
  reconcileNativeSoftLocks,
  startDeviceControlRuntime,
  stopDeviceControlRuntimeIfIdle,
} from '../../../../modules/device-control';
import type { DeviceControlPort } from '../application/DeviceControlPort';

export const deviceControlAdapter: DeviceControlPort = {
  async startRuntime() {
    const result = await startDeviceControlRuntime();
    return { status: result.status, reason: result.reason };
  },

  async reconcileSoftLocks(activeLocks) {
    const result = await reconcileNativeSoftLocks(activeLocks);
    if (result.status === 'ok') {
      return { status: 'ok', appliedCount: result.appliedCount };
    }
    if (result.status === 'runtime_unavailable') {
      return {
        status: 'runtime_unavailable',
        reason: result.reason ?? 'device control runtime 未 attach',
      };
    }
    return {
      status: 'failed',
      reason: result.reason ?? `device control reconcile 失败（${result.status}）`,
    };
  },

  async getRuntimeState() {
    const state = await getDeviceControlRuntimeState();
    return {
      serviceRunning: state.serviceRunning,
      runtimeAttached: state.runtimeAttached,
      observerConnected: state.observerConnected,
      currentWindow: state.currentWindow ? { ...state.currentWindow } : null,
      projectedLocks: state.projectedLocks.map((lock) => ({ ...lock })),
      matchingLockId: state.matchingLockId,
      targetMatched: state.targetMatched,
      shouldBlock: state.shouldBlock,
      attached: state.attached,
      attachedLockId: state.attachedLockId,
      overlayStatus: state.overlayStatus,
      diagnostics: {
        attachedAtEpochMs: state.diagnostics.attachedAtEpochMs,
        lastReconcileAtEpochMs: state.diagnostics.lastReconcileAtEpochMs,
        lastWindowEventAtEpochMs: state.diagnostics.lastWindowEventAtEpochMs,
        lastConnectionEventAtEpochMs: state.diagnostics.lastConnectionEventAtEpochMs,
        lastFailure: state.diagnostics.lastFailure
          ? { ...state.diagnostics.lastFailure }
          : null,
      },
    };
  },

  async stopRuntimeIfIdle() {
    const result = await stopDeviceControlRuntimeIfIdle();
    return {
      status: result.status,
      activeProjectionCount: result.activeProjectionCount,
      reason: result.reason,
    };
  },

  async openApp(packageName) {
    return openApp(packageName);
  },

  async dispatchBrowsableUri(packageName, uri) {
    return dispatchBrowsableUri(packageName, uri);
  },
};
