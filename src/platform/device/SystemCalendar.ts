/** 系统日历是独立提醒载体；工具只检查权限，只有设置页主动申请权限。 */
import { Linking, PermissionsAndroid } from 'react-native';
import DeviceControl from '../../../modules/device-control';

export type SystemCalendarAvailability = 'ready' | 'permission_required' | 'no_writable_calendar';

export interface SystemCalendarEvent {
  key: string;
  title: string;
  description: string;
  startAtEpochMs: number;
}

export interface SystemCalendarPort {
  prepare(): Promise<SystemCalendarAvailability>;
  upsert(event: SystemCalendarEvent): Promise<void>;
  remove(key: string): Promise<void>;
  listKeys(): Promise<string[]>;
}

export const systemCalendar: SystemCalendarPort = {
  prepare: () => DeviceControl.prepareSystemCalendar(),
  upsert: (event) => DeviceControl.upsertSystemCalendarEvent(event.key, event.title, event.description, event.startAtEpochMs),
  remove: (key) => DeviceControl.removeSystemCalendarEvent(key),
  listKeys: () => DeviceControl.listSystemCalendarEventKeys(),
};

const calendarPermissions = [
  PermissionsAndroid.PERMISSIONS.READ_CALENDAR,
  PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR,
];

export async function isSystemCalendarPermissionGranted(): Promise<boolean> {
  return (await Promise.all(calendarPermissions.map(permission => PermissionsAndroid.check(permission))))
    .every(Boolean);
}

export async function manageSystemCalendarPermission(): Promise<void> {
  if (await isSystemCalendarPermissionGranted()) {
    await Linking.openSettings();
    return;
  }
  const result = await PermissionsAndroid.requestMultiple(calendarPermissions);
  if (calendarPermissions.some(permission => result[permission] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)) {
    await Linking.openSettings();
  }
}
