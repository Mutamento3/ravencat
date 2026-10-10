/** 执行当前窗口的安全检查、临时截图与 native cache 释放。 */

import {
  captureDeviceObserverScreenshot,
  deleteDeviceObserverScreenshot,
  getCurrentWindowState,
  getDeviceObserverConnectionState,
  type DeviceObserverScreenshot,
  type DeviceObserverWindowState,
} from '@features/deviceControl';
import { loadCurrentProtectedPackages } from '@features/phoneTools';
import {
  SCREEN_CAPTURE_FAILURE_REASONS,
  ScreenCaptureError,
  type ScreenCaptureFailureReason,
} from './ScreenCapturePolicy';
import {
  assertScreenObservationWindowAllowed,
  ScreenObservationPolicyError,
  type ScreenObservationWindowIdentity,
} from './ScreenObservationPolicy';

export interface CapturedScreen {
  screenshot: DeviceObserverScreenshot;
  windowState: DeviceObserverWindowState;
}

/**
 * 读取一次设备观察事实并截取当前窗口。
 *
 * Screen Capture 与未来语义观察从同一持久策略入口解析当前保护集合。
 */
export async function captureScreenForCurrentWindow(): Promise<CapturedScreen> {
  const [connection, windowState, protectedPackages] = await Promise.all([
    getDeviceObserverConnectionState(),
    getCurrentWindowState(),
    loadCurrentProtectedPackages(),
  ]);

  if (!connection.accessibilityEnabled) {
    throw new ScreenCaptureError(
      'accessibility_disabled',
      '请先在 Android 设置中启用 RavenCat 设备观察。',
    );
  }
  if (!connection.accessibilityConnected) {
    throw new ScreenCaptureError(
      'accessibility_disconnected',
      '设备观察服务当前未连接，请返回设置页刷新后重试。',
    );
  }
  if (!connection.canTakeScreenshot) {
    throw new ScreenCaptureError(
      'screenshot_capability_missing',
      '当前 Android 无障碍服务没有截屏能力。',
    );
  }

  const expectedWindow = resolveCaptureWindow(
    windowState,
    protectedPackages,
  );

  let screenshot: DeviceObserverScreenshot;
  try {
    // `ravencat_` 是 native cache 文件名的一部分，保留既有标识以兼容清理与诊断。
    screenshot = await captureDeviceObserverScreenshot({
      requestId: buildCaptureRequestId(),
      target: 'current_window',
      expectedWindow,
    });
  } catch (error) {
    throw normalizeScreenCaptureError(error);
  }

  return {
    screenshot,
    windowState,
  };
}

function resolveCaptureWindow(
  windowState: DeviceObserverWindowState,
  protectedPackages: readonly string[],
): ScreenObservationWindowIdentity {
  try {
    return assertScreenObservationWindowAllowed(windowState, protectedPackages);
  } catch (error) {
    if (!(error instanceof ScreenObservationPolicyError)) throw error;
    throw new ScreenCaptureError(
      error.reason,
      error.message.replace('屏幕观察', '截屏'),
    );
  }
}

/** 释放当前 Feature 产生的 native 临时截图；Chat 附件持久化不属于此处。 */
export function releaseCapturedScreen(
  capture: CapturedScreen,
): Promise<void> {
  return deleteDeviceObserverScreenshot(capture.screenshot.uri);
}

function normalizeScreenCaptureError(error: unknown): ScreenCaptureError {
  if (error instanceof ScreenCaptureError) {
    return error;
  }

  const reason = (
    error && typeof error === 'object' && 'reason' in error
      ? String((error as { reason?: unknown }).reason || '')
      : 'capture_failed'
  );
  const normalizedReason = isScreenCaptureFailureReason(reason)
    ? reason
    : 'capture_failed';
  return new ScreenCaptureError(
    normalizedReason,
    error instanceof Error ? error.message : '设备观察截屏失败。',
  );
}

function isScreenCaptureFailureReason(
  value: string,
): value is ScreenCaptureFailureReason {
  return SCREEN_CAPTURE_FAILURE_REASONS.some((reason) => reason === value);
}

function buildCaptureRequestId(): string {
  return `ravencat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
