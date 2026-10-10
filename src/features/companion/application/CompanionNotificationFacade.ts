/** 向 RavenCat 界面与宿主暴露统一系统通知能力。 */
import { getCompanionRuntimeDependencies } from './CompanionRuntimeDependencies';

export function requestCompanionNotificationPermission(): Promise<boolean> {
  return getCompanionRuntimeDependencies().notifications.requestPermission();
}

export function getCompanionNotificationDiagnostics() {
  return getCompanionRuntimeDependencies().notifications.getDiagnostics();
}
