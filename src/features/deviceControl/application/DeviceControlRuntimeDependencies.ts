/**
 * Device Control 运行时依赖契约。
 *
 * Device Control 只执行受控操作，不做 Companion 业务决策，因此这里只包含
 * 执行真正需要的原生端口、Soft Lock 仓储与 id 生成，不持有聊天、AI 或主动联系能力。
 */

import type { ISoftAppLockRepository } from '../domain/SoftAppLockRepository';
import type { DeviceControlPort } from './DeviceControlPort';
import type { DeviceObserverPort } from './DeviceObserverPort';
import type { MediaSessionControlPort } from './MediaSessionControlPort';
import type { MediaSessionObservationPort } from './MediaSessionObservationPort';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface DeviceControlRuntimeDependencies {
  repositories: {
    softAppLocks: ISoftAppLockRepository;
  };
  native: {
    deviceControl: DeviceControlPort;
    deviceObserver: DeviceObserverPort;
    mediaSessionObservation: MediaSessionObservationPort;
    /** 与 observation 分开注入：读事实与对外副作用是两种语义。 */
    mediaSessionControl: MediaSessionControlPort;
  };
  generateSoftAppLockId(): string;
}

const deviceControlRuntimeSlot = createRuntimeSlot<DeviceControlRuntimeDependencies>(
  'DeviceControl',
);

export function configureDeviceControlRuntimeDependencies(
  dependencies: DeviceControlRuntimeDependencies,
): void {
  deviceControlRuntimeSlot.configure(dependencies);
}

export function getDeviceControlRuntimeDependencies(): DeviceControlRuntimeDependencies {
  return deviceControlRuntimeSlot.get();
}
