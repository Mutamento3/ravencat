/**
 * Device Control 通用 action primitive：exact Android package + 已校验 browsable URI
 * → Protected Apps action admission → native ACTION_VIEW dispatch。
 *
 * 固定顺序：validate package → validate URI → load Protected Apps → assert action allowed
 * → native dispatch。Protected Apps 必须在 native dispatch 之前，native 层不读取
 * RavenCat 受保护应用设置。
 *
 * 这一层不知道任何具体 App：不认识具体 App 的 route、业务 ID、Tool Package、Agent 或 AI prompt。
 * 具体 app route 的构造属于对应 product/application 层，本 primitive 只执行受控派发。
 *
 * dispatch success 只代表 Android 接受了这次启动请求：不代表目标页面已打开、不代表目标 UI 正确、
 * 不代表任何业务结果（例如音乐已开始播放）。最终状态必须由新的设备事实表达，本层不轮询、不重试。
 */

import {
  assertProtectedAppCapabilityAllowed,
  loadCurrentProtectedPackages,
  ProtectedAppsPolicyError,
} from '@features/phoneTools';
import { isValidBrowsableUri } from './BrowsableUriTarget';
import { getDeviceControlRuntimeDependencies } from './DeviceControlRuntimeDependencies';
import { isValidExactTargetPackage } from './ExactPackageTarget';

export type DispatchBrowsableUriResult = {
  status: 'uri_dispatched';
  targetPackage: string;
};

export type DispatchBrowsableUriFailureReason =
  | 'invalid_target_package'
  | 'invalid_target_uri'
  | 'protected_app'
  | 'route_unavailable'
  | 'route_dispatch_failed';

/** 预期的业务失败统一收敛为一个 error contract，供上层单点处理。 */
export class DispatchBrowsableUriError extends Error {
  readonly reason: DispatchBrowsableUriFailureReason;

  constructor(reason: DispatchBrowsableUriFailureReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = 'DispatchBrowsableUriError';
  }
}

export async function dispatchBrowsableUriToPackage(
  packageName: string,
  uri: string,
): Promise<DispatchBrowsableUriResult> {
  if (!isValidExactTargetPackage(packageName)) {
    throw new DispatchBrowsableUriError(
      'invalid_target_package',
      '必须提供不含空白的精确 Android package name',
    );
  }

  if (!isValidBrowsableUri(uri)) {
    throw new DispatchBrowsableUriError(
      'invalid_target_uri',
      '必须提供单个非空、带明确 scheme 且长度受限的可浏览 URI',
    );
  }

  // 保留调用者给出的 exact package identity，不做 toLowerCase 改写；
  // Protected Apps 比较由 policy 内部自行 normalization。
  const targetPackage = packageName.trim();

  const protectedPackages = await loadCurrentProtectedPackages();
  try {
    assertProtectedAppCapabilityAllowed(targetPackage, protectedPackages, 'action');
  } catch (error) {
    if (!(error instanceof ProtectedAppsPolicyError)) {
      throw error;
    }
    throw new DispatchBrowsableUriError('protected_app', error.message);
  }

  const result = await getDeviceControlRuntimeDependencies()
    .native
    .deviceControl
    .dispatchBrowsableUri(targetPackage, uri);

  if (result.status === 'uri_dispatched') {
    // 不回传完整 URI：dispatch 结果只暴露被执行的 exact package。
    return { status: 'uri_dispatched', targetPackage: result.packageName };
  }

  throw new DispatchBrowsableUriError(result.status, `URI 派发失败：${result.reason}`);
}
