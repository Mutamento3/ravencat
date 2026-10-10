/** 组装 Device Control 的 Soft Lock 仓储与 Android 原生执行能力。 */

import {
  configureDeviceControlRuntimeDependencies,
  deviceControlAdapter,
  deviceObserverAdapter,
  mediaSessionControlAdapter,
  mediaSessionObservationAdapter,
  softAppLockRepository,
} from '@features/deviceControl/composition';
import { createRandomUUID } from '@platform/device';

let configured = false;

export function configureDeviceControlRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureDeviceControlRuntimeDependencies({
    repositories: {
      softAppLocks: softAppLockRepository,
    },
    native: {
      deviceControl: deviceControlAdapter,
      deviceObserver: deviceObserverAdapter,
      mediaSessionObservation: mediaSessionObservationAdapter,
      mediaSessionControl: mediaSessionControlAdapter,
    },
    generateSoftAppLockId: () => `soft-lock-${createRandomUUID()}`,
  });
}
