/** 定义 RavenCat 主动消息所需的系统通知窄接口。 */
export interface CompanionNotificationDiagnostics {
  channelId: string;
  postNotificationsGranted: boolean;
  notificationsEnabled: boolean;
  channelImportance: number;
  lastNotificationAttemptAtEpochMs: number;
  lastNotificationShown: boolean;
  lastNotificationAIId?: string | null;
  lastNotificationSessionId?: string | null;
  lastNotificationError?: string | null;
}

export interface CompanionNotificationPort {
  requestPermission(): Promise<boolean>;
  getDiagnostics(): Promise<CompanionNotificationDiagnostics>;
}
