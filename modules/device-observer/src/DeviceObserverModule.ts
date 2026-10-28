/** 暴露 Android 设备观察服务的连接状态与当前窗口事实。 */

import {
  EventEmitter,
  NativeModule,
  requireNativeModule,
} from 'expo';

export type DeviceObserverConnectionState = {
  accessibilityEnabled: boolean;
  accessibilityConnected: boolean;
  canRetrieveWindowContent: boolean;
  canTakeScreenshot: boolean;
  connectedAtEpochMs: number;
  lastDisconnectedAtEpochMs: number;
  lastEventAtEpochMs: number;
};

export type DeviceObserverWindowState = {
  packageName: string | null;
  windowId: number | null;
  title: string | null;
  detectionReliable: boolean;
  checkedAtEpochMs: number;
  source: 'accessibility' | 'usage_events' | 'unknown';
};

export type DeviceScreenshot = {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
  capturedAtEpochMs: number;
  packageName: string | null;
  windowId: number | null;
  source: 'accessibility_display' | 'accessibility_window';
};

export type DeviceScreenshotWindowIdentity = {
  packageName: string | null;
  windowId: number;
};

export type DeviceScreenshotRequest = {
  requestId: string;
} & (
  | {
      target: 'current_window';
      expectedWindow: DeviceScreenshotWindowIdentity;
    }
  | {
      target: 'default_display';
    }
);

export type DeviceSemanticNode = {
  depth: number;
  text: string | null;
  contentDescription: string | null;
  className: string | null;
  clickable: boolean;
  editable: boolean;
  password: boolean;
};

export type DeviceSemanticSnapshot = {
  packageName: string;
  windowId: number;
  capturedAtEpochMs: number;
  nodes: DeviceSemanticNode[];
  truncation: {
    nodeLimitReached: boolean;
    depthLimitReached: boolean;
    characterLimitReached: boolean;
  };
};

export type DeviceSemanticReadRequest = {
  expectedWindow: DeviceScreenshotWindowIdentity;
};

/** 原生 OCR 只保留 line 文本；block 文本由消费方从 lines 派生，坐标与语言元数据不经过桥。 */
export type DeviceOcrLine = {
  text: string;
};

export type DeviceOcrBlock = {
  lines: DeviceOcrLine[];
};

export type DeviceOcrSnapshot = {
  blocks: DeviceOcrBlock[];
  truncation: {
    blockLimitReached: boolean;
    lineLimitReached: boolean;
    characterLimitReached: boolean;
  };
};

export type DeviceOcrFailureReason =
  | 'invalid_ocr_input'
  | 'ocr_failed';

export type DeviceSemanticReadFailureReason =
  | 'accessibility_disabled'
  | 'accessibility_disconnected'
  | 'window_unavailable'
  | 'window_changed'
  | 'semantic_read_failed';

export type DeviceScreenshotFailureReason =
  | 'accessibility_disabled'
  | 'accessibility_disconnected'
  | 'screenshot_capability_missing'
  | 'window_changed'
  | 'window_unavailable'
  | 'secure_window'
  | 'capture_interval_too_short'
  | 'invalid_display'
  | 'invalid_window'
  | 'image_write_failed'
  | 'capture_failed';

export interface InstalledLaunchableApp {
  packageName: string;
  label: string;
  iconDataUri: string | null;
  isSystemApp: boolean;
}

export type InstalledAppsQueryFailureReason = 'installed_apps_query_failed';

export class InstalledAppsQueryError extends Error {
  constructor(
    public readonly reason: InstalledAppsQueryFailureReason,
    message: string,
    public readonly nativeCode?: string,
  ) {
    super(message);
    this.name = 'InstalledAppsQueryError';
  }
}

export class DeviceScreenshotError extends Error {
  constructor(
    public readonly reason: DeviceScreenshotFailureReason,
    message: string,
    public readonly nativeCode?: string,
  ) {
    super(message);
    this.name = 'DeviceScreenshotError';
  }
}

export class DeviceSemanticReadError extends Error {
  constructor(
    public readonly reason: DeviceSemanticReadFailureReason,
    message: string,
    public readonly nativeCode?: string,
  ) {
    super(message);
    this.name = 'DeviceSemanticReadError';
  }
}

export class DeviceOcrError extends Error {
  constructor(
    public readonly reason: DeviceOcrFailureReason,
    message: string,
    public readonly nativeCode?: string,
  ) {
    super(message);
    this.name = 'DeviceOcrError';
  }
}

export type DeviceObserverEventSubscription = {
  remove(): void;
};

type DeviceObserverEvents = {
  onConnectionStateChanged: (event: DeviceObserverConnectionState) => void;
  onWindowStateChanged: (event: DeviceObserverWindowState) => void;
};

export type DeviceBatterySnapshot =
  | { status: 'available'; levelPercent: number; chargingState: 'charging' | 'full' | 'not_charging' | 'unknown' }
  | { status: 'unavailable' };

export type DeviceClipboardSnapshot =
  | { status: 'available'; text: string; truncated: boolean }
  | { status: 'app_not_focused' | 'clipboard_unavailable' | 'no_text' };

export interface AppUsageEntry {
  packageName: string;
  foregroundTimeMs: number;
  firstTimestampEpochMs: number;
  lastTimestampEpochMs: number;
  lastTimeUsedEpochMs: number;
}

export type AppUsageSnapshot =
  | { status: 'available'; requestedStartEpochMs: number; requestedEndEpochMs: number; apps: AppUsageEntry[] }
  | { status: 'permission_not_granted' }
  | { status: 'device_locked' };

export interface InstalledApplicationInfo {
  name: string;
  version: string;
  buildNumber: string;
}

export interface DeviceLocationAccessState {
  permission: 'not_granted' | 'approximate' | 'precise';
  servicesEnabled: boolean;
}

export type DeviceLocationSnapshot =
  | { status: 'available'; latitude: number; longitude: number; accuracyMeters: number;
      measuredAtEpochMs: number; ageMs: number; permission: 'approximate' | 'precise'; isMock: boolean }
  | { status: 'permission_not_granted' | 'location_services_disabled' | 'location_provider_unavailable' | 'location_unavailable' };

declare class DeviceObserverNativeModule extends NativeModule {
  readClipboardText(): Promise<DeviceClipboardSnapshot>;
  getLocationAccessState(): Promise<DeviceLocationAccessState>;
  getCurrentLocation(): Promise<DeviceLocationSnapshot>;
  openLocationSettings(): Promise<void>;
  getInstalledApplicationInfo(): InstalledApplicationInfo;
  getBatterySnapshot(): Promise<DeviceBatterySnapshot>;
  isUsageAccessGranted(): Promise<boolean>;
  openUsageAccessSettings(): Promise<void>;
  queryAppUsage(beginTime: number, endTime: number): Promise<AppUsageSnapshot>;
  openAccessibilitySettings(): Promise<void>;
  getConnectionState(): Promise<DeviceObserverConnectionState>;
  getCurrentWindowState(): Promise<DeviceObserverWindowState>;
  getInstalledLaunchableApps(): Promise<InstalledLaunchableApp[]>;
  clearInstalledAppIconCache(): Promise<void>;
  captureScreenshot(input: DeviceScreenshotRequest): Promise<DeviceScreenshot>;
  readSemanticSnapshot(input: DeviceSemanticReadRequest): Promise<DeviceSemanticSnapshot>;
  recognizeScreenshotText(uri: string): Promise<DeviceOcrSnapshot>;
  deleteScreenshot(uri: string): Promise<void>;
  clearDeviceObserverDataForFactoryReset(): Promise<void>;
}

const DeviceObserver = requireNativeModule<DeviceObserverNativeModule>(
  'KimiPhoneDeviceObserver',
);

export function getInstalledApplicationInfo(): InstalledApplicationInfo {
  return DeviceObserver.getInstalledApplicationInfo();
}

const emitter = new EventEmitter<DeviceObserverEvents>(DeviceObserver);

export function openDeviceObserverAccessibilitySettings(): Promise<void> {
  return DeviceObserver.openAccessibilitySettings();
}

export function getDeviceObserverConnectionState(): Promise<DeviceObserverConnectionState> {
  return DeviceObserver.getConnectionState();
}

export function getDeviceObserverCurrentWindowState(): Promise<DeviceObserverWindowState> {
  return DeviceObserver.getCurrentWindowState();
}

export async function getInstalledLaunchableApps(): Promise<InstalledLaunchableApp[]> {
  try {
    return await DeviceObserver.getInstalledLaunchableApps();
  } catch (error) {
    throw normalizeInstalledAppsQueryError(error);
  }
}

export async function clearInstalledAppIconCache(): Promise<void> {
  await DeviceObserver.clearInstalledAppIconCache();
}

export async function captureDeviceObserverScreenshot(
  input: DeviceScreenshotRequest,
): Promise<DeviceScreenshot> {
  try {
    return await DeviceObserver.captureScreenshot(input);
  } catch (error) {
    throw normalizeScreenshotError(error);
  }
}

export async function readDeviceObserverSemanticSnapshot(
  input: DeviceSemanticReadRequest,
): Promise<DeviceSemanticSnapshot> {
  try {
    return await DeviceObserver.readSemanticSnapshot(input);
  } catch (error) {
    throw normalizeSemanticReadError(error);
  }
}

/** 只对已经冻结的 RavenCat 设备观察截图执行本地 OCR。 */
export async function recognizeDeviceObserverScreenshotText(
  uri: string,
): Promise<DeviceOcrSnapshot> {
  try {
    return await DeviceObserver.recognizeScreenshotText(uri);
  } catch (error) {
    throw normalizeOcrError(error);
  }
}

export async function deleteDeviceObserverScreenshot(uri: string): Promise<void> {
  try {
    await DeviceObserver.deleteScreenshot(uri);
  } catch (error) {
    throw normalizeScreenshotError(error);
  }
}

/** 恢复出厂：清空连接诊断与最近窗口信息，不关闭无障碍权限。 */
export function clearDeviceObserverDataForFactoryReset(): Promise<void> {
  return DeviceObserver.clearDeviceObserverDataForFactoryReset();
}

export function addDeviceObserverConnectionStateListener(
  listener: (event: DeviceObserverConnectionState) => void,
): DeviceObserverEventSubscription {
  return emitter.addListener('onConnectionStateChanged', listener);
}

export function addDeviceObserverWindowStateListener(
  listener: (event: DeviceObserverWindowState) => void,
): DeviceObserverEventSubscription {
  return emitter.addListener('onWindowStateChanged', listener);
}

function normalizeScreenshotError(error: unknown): DeviceScreenshotError {
  if (error instanceof DeviceScreenshotError) {
    return error;
  }

  const nativeCode = (
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : ''
  );
  const prefix = 'ERR_DEVICE_SCREENSHOT_';
  const candidate = nativeCode.startsWith(prefix)
    ? nativeCode.slice(prefix.length).toLowerCase()
    : 'capture_failed';
  const reason = isDeviceScreenshotFailureReason(candidate)
    ? candidate
    : 'capture_failed';
  const message = error instanceof Error
    ? error.message
    : '设备观察截屏失败';
  return new DeviceScreenshotError(reason, message, nativeCode || undefined);
}

function normalizeSemanticReadError(error: unknown): DeviceSemanticReadError {
  if (error instanceof DeviceSemanticReadError) return error;
  const nativeCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const prefix = 'ERR_DEVICE_SEMANTIC_READ_';
  const candidate = nativeCode.startsWith(prefix)
    ? nativeCode.slice(prefix.length).toLowerCase()
    : 'semantic_read_failed';
  const reason = isDeviceSemanticReadFailureReason(candidate)
    ? candidate
    : 'semantic_read_failed';
  return new DeviceSemanticReadError(
    reason,
    error instanceof Error ? error.message : '设备观察语义读取失败',
    nativeCode || undefined,
  );
}

function isDeviceSemanticReadFailureReason(
  value: string,
): value is DeviceSemanticReadFailureReason {
  return [
    'accessibility_disabled',
    'accessibility_disconnected',
    'window_unavailable',
    'window_changed',
    'semantic_read_failed',
  ].includes(value);
}

function isDeviceScreenshotFailureReason(
  value: string
): value is DeviceScreenshotFailureReason {
  return [
    'accessibility_disabled',
    'accessibility_disconnected',
    'screenshot_capability_missing',
    'window_changed',
    'window_unavailable',
    'secure_window',
    'capture_interval_too_short',
    'invalid_display',
    'invalid_window',
    'image_write_failed',
    'capture_failed',
  ].includes(value);
}

function normalizeOcrError(error: unknown): DeviceOcrError {
  if (error instanceof DeviceOcrError) return error;
  const nativeCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const prefix = 'ERR_DEVICE_OCR_';
  const candidate = nativeCode.startsWith(prefix)
    ? nativeCode.slice(prefix.length).toLowerCase()
    : 'ocr_failed';
  return new DeviceOcrError(
    isDeviceOcrFailureReason(candidate) ? candidate : 'ocr_failed',
    error instanceof Error ? error.message : '本地 OCR 识别失败',
    nativeCode || undefined,
  );
}

function isDeviceOcrFailureReason(value: string): value is DeviceOcrFailureReason {
  return ['invalid_ocr_input', 'ocr_failed'].includes(value);
}

function normalizeInstalledAppsQueryError(error: unknown): InstalledAppsQueryError {
  if (error instanceof InstalledAppsQueryError) {
    return error;
  }
  const nativeCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : '';
  const message = error instanceof Error
    ? error.message
    : '无法读取 Android 桌面应用列表';
  return new InstalledAppsQueryError(
    'installed_apps_query_failed',
    message,
    nativeCode || undefined,
  );
}

export function getDeviceBatterySnapshot(): Promise<DeviceBatterySnapshot> {
  return DeviceObserver.getBatterySnapshot();
}

export function readDeviceClipboardText(): Promise<DeviceClipboardSnapshot> {
  return DeviceObserver.readClipboardText();
}

export function isUsageAccessGranted(): Promise<boolean> {
  return DeviceObserver.isUsageAccessGranted();
}

export function openUsageAccessSettings(): Promise<void> {
  return DeviceObserver.openUsageAccessSettings();
}

export function queryAppUsage(beginTime: number, endTime: number): Promise<AppUsageSnapshot> {
  return DeviceObserver.queryAppUsage(beginTime, endTime);
}

export default DeviceObserver;

export function getDeviceLocationAccessState(): Promise<DeviceLocationAccessState> {
  return DeviceObserver.getLocationAccessState();
}

export function getCurrentDeviceLocation(): Promise<DeviceLocationSnapshot> {
  return DeviceObserver.getCurrentLocation();
}

export function openDeviceLocationSettings(): Promise<void> {
  return DeviceObserver.openLocationSettings();
}
