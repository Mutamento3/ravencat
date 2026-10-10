/** 向 UI / 后续产品层暴露无产品策略的 MediaSession 技术事实。 */

import { getDeviceControlRuntimeDependencies } from './DeviceControlRuntimeDependencies';

function getMediaSessionObservation() {
  return getDeviceControlRuntimeDependencies().native.mediaSessionObservation;
}
export function getNotificationListenerAccessState() {
  return getMediaSessionObservation().getNotificationListenerAccessState();
}

export function openNotificationListenerSettings() {
  return getMediaSessionObservation().openNotificationListenerSettings();
}

export function getMediaSessionSnapshot(packageName: string) {
  return getMediaSessionObservation().getMediaSessionSnapshot(packageName);
}
