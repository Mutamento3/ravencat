/** 屏幕语义读取与截图共用的受保护应用和当前窗口准入策略。 */

import type {
  DeviceObserverWindowState,
} from '@features/deviceControl';
import {
  assertProtectedAppCapabilityAllowed,
  ProtectedAppsPolicyError,
} from '@features/phoneTools';

export type ScreenObservationPolicyFailureReason =
  | 'window_unavailable'
  | 'protected_app';

export interface ScreenObservationWindowIdentity {
  packageName: string;
  windowId: number;
}

export class ScreenObservationPolicyError extends Error {
  readonly reason: ScreenObservationPolicyFailureReason;

  constructor(
    reason: ScreenObservationPolicyFailureReason,
    message: string,
  ) {
    super(message);
    this.reason = reason;
    this.name = 'ScreenObservationPolicyError';
  }
}

/** 返回已经通过统一隐私策略校验、可交给 native fence 的窗口身份。 */
export function assertScreenObservationWindowAllowed(
  windowState: DeviceObserverWindowState,
  protectedPackages: readonly string[],
): ScreenObservationWindowIdentity {
  if (windowState.windowId === null) {
    throw new ScreenObservationPolicyError(
      'window_unavailable',
      '无法确认当前窗口，已按隐私策略阻止屏幕观察。',
    );
  }
  if (!windowState.packageName) {
    throw new ScreenObservationPolicyError(
      'window_unavailable',
      '无法确认当前应用，已按隐私策略阻止屏幕观察。',
    );
  }

  try {
    assertProtectedAppCapabilityAllowed(
      windowState.packageName,
      protectedPackages,
      'observation',
    );
  } catch (error) {
    if (!(error instanceof ProtectedAppsPolicyError)) throw error;
    throw new ScreenObservationPolicyError(
      'protected_app',
      error.message,
    );
  }

  if (!windowState.detectionReliable) {
    throw new ScreenObservationPolicyError(
      'window_unavailable',
      '当前窗口识别不可靠，已按隐私策略阻止屏幕观察。',
    );
  }
  return {
    packageName: windowState.packageName,
    windowId: windowState.windowId,
  };
}
