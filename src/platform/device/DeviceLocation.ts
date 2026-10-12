/** 定位权限只在用户点击入口时申请；工具调用仅消费原生系统事实。 */
import { Linking, PermissionsAndroid } from 'react-native';
import { getDeviceLocationAccessState } from '../../../modules/device-observer';

export {
  getDeviceLocationAccessState,
  getCurrentDeviceLocation,
  openDeviceLocationSettings,
  type DeviceLocationAccessState,
  type DeviceLocationSnapshot,
} from '../../../modules/device-observer';

export async function manageDeviceLocationPermission(): Promise<void> {
  const access = await getDeviceLocationAccessState();
  if (access.permission !== 'not_granted') {
    await Linking.openSettings();
    return;
  }
  // Android 的精确/大致位置选择要求同时申请这两项，不索取后台定位权限。
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  ]);
  if (result[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
    await Linking.openSettings();
  }
}
