/** 仅供 Host 组装 Phone Tools 的设备事实、Protected Apps 真值与网易云设备能力依赖。 */

export {
  configureProtectedAppsRuntimeDependencies,
  type ProtectedAppsRuntimeDependencies,
} from './application/ProtectedAppsRuntimeDependencies';
export {
  configureForegroundAppRuntimeDependencies,
  type ForegroundAppRuntimeDependencies,
  type ForegroundAppWindowFact,
} from './application/ForegroundAppRuntimeDependencies';
/**
 * 网易云只通过 Host 注入得到派发执行能力：Phone Tools 不得静态 import
 * `@features/deviceControl`（Device Control application 反向依赖 Phone Tools 的
 * Protected Apps policy，会形成 feature cycle）。
 */
export {
  configureNetEaseMusicRuntimeDependencies,
  type NetEaseMusicRuntimeDependencies,
  type NetEaseUriDispatchFailureReason,
  type NetEaseUriDispatchResult,
} from './application/NetEaseMusicRuntimeDependencies';
export {
  configureNetEasePlaybackRuntimeDependencies,
  type NetEasePlaybackRuntimeDependencies,
} from './application/NetEasePlaybackRuntimeDependencies';
