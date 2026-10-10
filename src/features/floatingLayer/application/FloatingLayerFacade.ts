/** 通过应用层端口向外部调用方暴露悬浮层能力。 */

import { getFloatingLayerRuntimeDependencies } from './FloatingLayerRuntimeDependencies';
import type {
  CaptureScreenRequestEvent,
  EventSubscription,
  FloatingTogetherListeningPresentation,
  FloatingConversationPreview,
  ConversationDisplayedEvent,
  ReplyPreview,
  SendMessageEvent,
  TargetPreview,
} from './FloatingLayerPort';

function getFloatingLayer() {
  return getFloatingLayerRuntimeDependencies().native.floatingLayer;
}

export function addConversationRefreshListener(listener: () => void): EventSubscription {
  return getFloatingLayer().addConversationRefreshListener(listener);
}

export function updateConversationPreview(preview: FloatingConversationPreview): Promise<void> {
  return getFloatingLayer().updateConversationPreview(preview);
}

export function addCaptureScreenRequestListener(
  listener: (event: CaptureScreenRequestEvent) => void,
): EventSubscription {
  return getFloatingLayer().addCaptureScreenRequestListener(listener);
}

export function addConversationDisplayedListener(
  listener: (event: ConversationDisplayedEvent) => void,
): EventSubscription {
  return getFloatingLayer().addConversationDisplayedListener(listener);
}

export function addSendMessageListener(
  listener: (event: SendMessageEvent) => void,
): EventSubscription {
  return getFloatingLayer().addSendMessageListener(listener);
}

export function completeScreenCaptureVisibility(payload: {
  correlationId: string;
  succeeded: boolean;
  screenshotUri?: string;
}) {
  return getFloatingLayer().completeScreenCaptureVisibility(payload);
}

export function getBatteryOptimizationState() {
  return getFloatingLayer().getBatteryOptimizationState();
}

export function isFloatingLayerRunning() {
  return getFloatingLayer().isFloatingLayerRunning();
}

/**
 * 下发 Host 的 AppState 真值。
 *
 * 该命令只协调 native overlay 的可见性；Service 的生命周期仍由用户意图
 * 对账持有，前后台切换不得通过这里反复 start/stop。
 */
export function setAppForeground(active: boolean): Promise<void> {
  return getFloatingLayer().setAppForeground(active);
}

export function isOverlayPermissionGranted() {
  return getFloatingLayer().isOverlayPermissionGranted();
}

export function openOverlayPermissionSettings() {
  return getFloatingLayer().openOverlayPermissionSettings();
}

export function openBatteryOptimizationSettings() {
  return getFloatingLayer().openBatteryOptimizationSettings();
}

export function recordFloatingMessageTaskCompletion(payload: {
  correlationId: string;
  succeeded: boolean;
  error?: string | null;
}) {
  return getFloatingLayer().recordFloatingMessageTaskCompletion(payload);
}

export function restoreAfterScreenCapture() {
  return getFloatingLayer().restoreAfterScreenCapture();
}

export function requestIgnoreBatteryOptimizations() {
  return getFloatingLayer().requestIgnoreBatteryOptimizations();
}

export function startFloatingLayer() {
  return getFloatingLayer().startFloatingLayer();
}

export function stopFloatingLayer() {
  return getFloatingLayer().stopFloatingLayer();
}

export function updateReplyPreview(preview: ReplyPreview) {
  return getFloatingLayer().updateReplyPreview(preview);
}

export function updateTargetPreview(preview: TargetPreview) {
  return getFloatingLayer().updateTargetPreview(preview);
}

/**
 * 始终同步已提交的 Together 展示事实，原生层在未 attach 时只保存投影缓存。
 * 缓存与窗口生命周期独立，保证先进入一起听、后开启悬浮窗时能恢复当前状态。
 * 本命令不申请权限、不修复设置，也不启动 Service。
 */
export function updateTogetherListeningPresentation(
  presentation: FloatingTogetherListeningPresentation,
): Promise<void> {
  return getFloatingLayer().updateTogetherListeningPresentation(presentation);
}

/** identity-safe 清理由原生 projection cache 按 activityId 执行。 */
export function clearTogetherListeningPresentation(activityId?: string): Promise<void> {
  return getFloatingLayer().clearTogetherListeningPresentation(activityId);
}
