/**
 * Calls 来电通知的排障与系统设置入口。
 *
 * 来电通知的发布与撤销仍由 Calls runtime 直接负责；这里仅把
 * `incoming-call` scope 的系统事实翻译为 Calls 稳定 DTO，并转发显式设置操作。
 * scope 固定在此处，避免调用方接触 platform 的诊断键或误读其他通知 scope。
 */

import {
  getNotificationDiagnostics,
  openFullScreenIntentSettings as openNativeFullScreenIntentSettings,
  openIncomingCallNotificationSettings as openNativeIncomingCallNotificationSettings,
} from '@platform/device';
import type { NativeNotificationDiagnostics } from '@platform/device';

const INCOMING_CALL_NOTIFICATION_SCOPE = 'incoming-call' as const;

/** incoming-call scope 的实时系统状态与上次来电发布快照。 */
export interface IncomingCallDiagnostics {
  notificationsEnabled: boolean;
  incomingCallChannelImportance: number;
  /** 实际 Channel 锁屏可见性：1=PUBLIC / 0=PRIVATE / -1=SECRET；null 表示系统未返回。 */
  incomingCallChannelLockscreenVisibility: number | null;
  fullScreenIntentAllowed: boolean;
  /** 上次来电发布时刻（epoch ms）；0 表示尚未发布过来电。 */
  lastPostAttemptAtEpochMs: number;
  lastPostShown: boolean;
  lastPostError?: string | null;
  lastPostFullScreenIntentAllowed?: boolean | null;
  lastPostChannelImportance?: number | null;
  lastPostChannelLockscreenVisibility?: number | null;
  lastPostNotificationsEnabled?: boolean | null;
}

/** 读取来电专属 scope；不把 platform 的通用通知 DTO 泄漏给 Calls consumer。 */
export async function getIncomingCallDiagnostics(): Promise<IncomingCallDiagnostics> {
  const diagnostics = await getNotificationDiagnostics(INCOMING_CALL_NOTIFICATION_SCOPE);
  return mapIncomingCallDiagnostics(diagnostics);
}

/** 显式用户操作：Android 14+ 打开 FSI 系统授权页；不得自动调用。 */
export function openFullScreenIntentSettings(): Promise<boolean> {
  return openNativeFullScreenIntentSettings();
}

/** 显式用户操作：打开来电 Channel 系统通知设置页；不得自动调用。 */
export function openIncomingCallNotificationSettings(): Promise<boolean> {
  return openNativeIncomingCallNotificationSettings();
}

function mapIncomingCallDiagnostics(
  diagnostics: NativeNotificationDiagnostics,
): IncomingCallDiagnostics {
  return {
    notificationsEnabled: diagnostics.notificationsEnabled,
    incomingCallChannelImportance: diagnostics.incomingCallChannelImportance,
    incomingCallChannelLockscreenVisibility: diagnostics.incomingCallChannelLockscreenVisibility,
    fullScreenIntentAllowed: diagnostics.fullScreenIntentAllowed,
    lastPostAttemptAtEpochMs: diagnostics.lastNotificationAttemptAtEpochMs,
    lastPostShown: diagnostics.lastNotificationShown,
    lastPostError: diagnostics.lastNotificationError,
    lastPostFullScreenIntentAllowed: diagnostics.lastNotificationFullScreenIntentAllowed,
    lastPostChannelImportance: diagnostics.lastNotificationIncomingCallChannelImportance,
    lastPostChannelLockscreenVisibility:
      diagnostics.lastNotificationIncomingCallChannelLockscreenVisibility,
    lastPostNotificationsEnabled: diagnostics.lastNotificationNotificationsEnabled,
  };
}
