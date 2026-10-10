/** 通过 Companion 原生端口暴露调度、健康状态与兼容数据清理能力。 */

import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';
import type {
  CompanionNativeSubscription,
  CompanionWakeEvent,
} from './CompanionNativePort';

function getCompanionNative() {
  return getCompanionRuntimeDependencies().native.companion;
}

export function addCompanionWakeListener(
  listener: (event: CompanionWakeEvent) => void,
): CompanionNativeSubscription {
  return getCompanionNative().addCompanionWakeListener(listener);
}

export function addCompanionExecutionCancelListener(
  listener: (event: { deliveryEventId: string }) => void,
): CompanionNativeSubscription {
  return getCompanionNative().addCompanionExecutionCancelListener(listener);
}


/** Headless runner 启动后主动消费本次 delivery 的取消标记；true = 取消早于注册，必须追平。 */
export function consumeCompanionExecutionCancellation(deliveryEventId: string): Promise<boolean> {
  return getCompanionNative().consumeExecutionCancellation(deliveryEventId);
}

export function clearCompanionNativeDataForFactoryReset(): Promise<void> {
  return getCompanionNative().clearCompanionNativeDataForFactoryReset();
}

export function getNativeHealth() {
  return getCompanionNative().getNativeHealth();
}
