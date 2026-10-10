package expo.modules.devicecontrol.runtime

import expo.modules.deviceobserver.DeviceObserverConnectionState
import expo.modules.deviceobserver.DeviceWindowState
import expo.modules.deviceobserver.DeviceWindowObservationSource
import expo.modules.deviceobserver.DeviceWindowObservationSubscription

/**
 * Device Control 消费 Device Observer 稳定事实源的最小入口。
 *
 * 只镜像 DC2-A 建立的公共订阅 / 快照 contract：
 * - subscribeWindow / subscribeConnection / currentWindowState；
 * - 不触碰 Device Observer 的 internal publish 面；
 * - 绝不依赖 DeviceObserverAccessibilityService.connectedInstance()，
 *   也不把 AccessibilityService 变成 Device Control 的公共依赖。
 *
 * 该接口同时是 runtime 的注入缝：单测用 fake source 驱动事实流。
 */
interface DeviceObserverFactSource {
  fun subscribeWindow(
    listener: (DeviceWindowState) -> Unit,
  ): DeviceWindowObservationSubscription

  fun subscribeConnection(
    listener: (DeviceObserverConnectionState) -> Unit,
  ): DeviceWindowObservationSubscription

  fun currentWindowState(): DeviceWindowState
}

/** 默认实现：直连 DeviceWindowObservationSource 多订阅者事件源。 */
object NativeDeviceObserverFactSource : DeviceObserverFactSource {
  override fun subscribeWindow(
    listener: (DeviceWindowState) -> Unit,
  ): DeviceWindowObservationSubscription {
    return DeviceWindowObservationSource.subscribeWindow(listener)
  }

  override fun subscribeConnection(
    listener: (DeviceObserverConnectionState) -> Unit,
  ): DeviceWindowObservationSubscription {
    return DeviceWindowObservationSource.subscribeConnection(listener)
  }

  override fun currentWindowState(): DeviceWindowState {
    return DeviceWindowObservationSource.currentWindowState()
  }
}
