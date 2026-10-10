/** 安装包信息、电池与使用情况是按需设备查询，不依赖无障碍服务或悬浮层。 */
export {
  getInstalledApplicationInfo,
  type InstalledApplicationInfo,
  getDeviceBatterySnapshot,
  isUsageAccessGranted,
  openUsageAccessSettings,
  queryAppUsage,
  type DeviceBatterySnapshot,
  type AppUsageEntry,
  type AppUsageSnapshot,
} from '../../../modules/device-observer';
