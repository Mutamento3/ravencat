/** 封装通话摄像头权限查询与申请。 */

import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'expo-camera';
import type { CallCameraPermissionResult } from '../application/runtime/CallRuntimeDependencies';

function normalizePermissionResult(permission: ImagePicker.PermissionResponse): CallCameraPermissionResult {
  return {
    granted: permission.granted,
    canAskAgain: permission.canAskAgain,
    status: permission.status,
  };
}

export async function requestCallCameraPermission(): Promise<CallCameraPermissionResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  return normalizePermissionResult(permission);
}

export async function requestCallMicrophonePermission(): Promise<CallCameraPermissionResult> {
  return Camera.requestMicrophonePermissionsAsync();
}
