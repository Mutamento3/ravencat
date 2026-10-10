/** 仅供 Host 组装 Device Control 的具体仓储与 Android 适配器。 */

export { configureDeviceControlRuntimeDependencies } from './application/DeviceControlRuntimeDependencies';
export { deviceControlAdapter } from './infrastructure/DeviceControlAdapter';
export { deviceObserverAdapter } from './infrastructure/DeviceObserverAdapter';
export { mediaSessionControlAdapter } from './infrastructure/MediaSessionControlAdapter';
export { mediaSessionObservationAdapter } from './infrastructure/MediaSessionObservationAdapter';
export { softAppLockRepository } from './infrastructure/SQLiteSoftAppLockRepository';
