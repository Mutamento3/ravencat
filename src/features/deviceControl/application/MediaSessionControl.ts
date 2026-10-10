/**
 * exact-package MediaSession transport command 的 application 出口。
 *
 * 与 getMediaSessionSnapshot 严格分工：这里只做“派发”，成功只代表请求已交给目标
 * session，不代表 playback state 已经改变。调用方要确认结果必须显式再做一次
 * fresh snapshot 观察，本层不轮询、不等待、不合并两条语义。
 */

import { getDeviceControlRuntimeDependencies } from './DeviceControlRuntimeDependencies';
import type { MediaSessionTransportCommand } from './MediaSessionControlPort';

function getMediaSessionControl() {
  return getDeviceControlRuntimeDependencies().native.mediaSessionControl;
}

export function dispatchMediaSessionCommand(
  packageName: string,
  command: MediaSessionTransportCommand,
) {
  return getMediaSessionControl().dispatchMediaSessionCommand(packageName, command);
}
