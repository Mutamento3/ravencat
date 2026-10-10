/** 为业务 Feature 提供与具体 Expo 模块名解耦的设备观察能力。 */

import {
  addDeviceObserverConnectionStateListener,
  addDeviceObserverWindowStateListener,
  captureDeviceObserverScreenshot,
  clearDeviceObserverDataForFactoryReset as clearDeviceObserverNativeDataForFactoryReset,
  clearInstalledAppIconCache,
  deleteDeviceObserverScreenshot,
  getDeviceObserverConnectionState,
  getDeviceObserverCurrentWindowState,
  getInstalledLaunchableApps,
  InstalledAppsQueryError,
  openDeviceObserverAccessibilitySettings,
  readDeviceObserverSemanticSnapshot,
  recognizeDeviceObserverScreenshotText,
  type DeviceObserverConnectionState,
  type DeviceObserverEventSubscription,
  type DeviceObserverWindowState,
  type DeviceOcrSnapshot,
  type DeviceScreenshot,
  type DeviceScreenshotRequest,
  type DeviceScreenshotWindowIdentity,
  type DeviceSemanticReadRequest,
  type DeviceSemanticSnapshot,
  type InstalledLaunchableApp,
} from '../../../modules/device-observer';

export interface DeviceObserver {
  addConnectionStateListener(
    listener: (state: DeviceObserverConnectionState) => void
  ): DeviceObserverEventSubscription;
  addWindowStateListener(
    listener: (state: DeviceObserverWindowState) => void
  ): DeviceObserverEventSubscription;
  getConnectionState(): Promise<DeviceObserverConnectionState>;
  getCurrentWindowState(): Promise<DeviceObserverWindowState>;
  getInstalledLaunchableApps(): Promise<InstalledLaunchableApp[]>;
  clearInstalledAppIconCache(): Promise<void>;
  captureScreenshot(input: DeviceScreenshotRequest): Promise<DeviceScreenshot>;
  readSemanticSnapshot(input: DeviceSemanticReadRequest): Promise<DeviceSemanticSnapshot>;
  recognizeScreenshotText(uri: string): Promise<DeviceOcrSnapshot>;
  deleteScreenshot(uri: string): Promise<void>;
  openAccessibilitySettings(): Promise<void>;
}

class NativeDeviceObserver implements DeviceObserver {
  addConnectionStateListener(
    listener: (state: DeviceObserverConnectionState) => void
  ): DeviceObserverEventSubscription {
    return addDeviceObserverConnectionStateListener(listener);
  }

  addWindowStateListener(
    listener: (state: DeviceObserverWindowState) => void
  ): DeviceObserverEventSubscription {
    return addDeviceObserverWindowStateListener(listener);
  }

  getConnectionState(): Promise<DeviceObserverConnectionState> {
    return getDeviceObserverConnectionState();
  }

  getCurrentWindowState(): Promise<DeviceObserverWindowState> {
    return getDeviceObserverCurrentWindowState();
  }

  getInstalledLaunchableApps(): Promise<InstalledLaunchableApp[]> {
    return getInstalledLaunchableApps();
  }

  clearInstalledAppIconCache(): Promise<void> {
    return clearInstalledAppIconCache();
  }

  captureScreenshot(input: DeviceScreenshotRequest): Promise<DeviceScreenshot> {
    return captureDeviceObserverScreenshot(input);
  }

  readSemanticSnapshot(input: DeviceSemanticReadRequest): Promise<DeviceSemanticSnapshot> {
    return readDeviceObserverSemanticSnapshot(input);
  }

  recognizeScreenshotText(uri: string): Promise<DeviceOcrSnapshot> {
    return recognizeDeviceObserverScreenshotText(uri);
  }

  deleteScreenshot(uri: string): Promise<void> {
    return deleteDeviceObserverScreenshot(uri);
  }

  openAccessibilitySettings(): Promise<void> {
    return openDeviceObserverAccessibilitySettings();
  }
}

export const deviceObserver: DeviceObserver = new NativeDeviceObserver();

/** 恢复出厂：清空设备观察诊断与最近窗口信息，不关闭无障碍权限。 */
export function clearDeviceObserverDataForFactoryReset(): Promise<void> {
  return clearDeviceObserverNativeDataForFactoryReset();
}

export type {
  DeviceObserverConnectionState,
  DeviceObserverEventSubscription,
  DeviceObserverWindowState,
  DeviceOcrSnapshot,
  DeviceScreenshot,
  DeviceScreenshotRequest,
  DeviceScreenshotWindowIdentity,
  DeviceSemanticReadRequest,
  DeviceSemanticSnapshot,
  InstalledLaunchableApp,
};

export { InstalledAppsQueryError };
