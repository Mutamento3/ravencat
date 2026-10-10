/**
 * Phone Tools 网易云 runtime dependency：只声明网易云真正需要的派发执行契约。
 *
 * Phone Tools 不得 import `@features/deviceControl`：Device Control application 已经依赖
 * Phone Tools 的 Protected Apps policy，反向静态依赖会形成 feature cycle。真实实现由 Host
 * composition 注入，这里只保留最小结构 contract。
 *
 * 这不是通用 DeviceController / AppProvider / route framework：只表达「exact package +
 * 已校验 browsable URI → 受控派发」这一件事。
 */

import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

/** 本地派发执行结果；只表达 Android 接受了启动请求，不表达目标 App 的页面或业务状态。 */
export type NetEaseUriDispatchResult = {
  status: 'uri_dispatched';
  targetPackage: string;
};

/** Host 注入的 Device Control primitive 可能表达的失败。 */
export type NetEaseUriDispatchFailureReason =
  | 'invalid_target_package'
  | 'invalid_target_uri'
  | 'protected_app'
  | 'route_unavailable'
  | 'route_dispatch_failed';

export interface NetEaseMusicRuntimeDependencies {
  dispatchBrowsableUriToPackage(
    packageName: string,
    uri: string,
  ): Promise<NetEaseUriDispatchResult>;
}

const neteaseMusicRuntimeSlot =
  createRuntimeSlot<NetEaseMusicRuntimeDependencies>('NetEase Music');

export function configureNetEaseMusicRuntimeDependencies(
  dependencies: NetEaseMusicRuntimeDependencies,
): void {
  neteaseMusicRuntimeSlot.configure(dependencies);
}

export function getNetEaseMusicRuntimeDependencies(): NetEaseMusicRuntimeDependencies {
  return neteaseMusicRuntimeSlot.get();
}
