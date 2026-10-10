package expo.modules.deviceobserver

import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import java.util.logging.Level
import java.util.logging.Logger

/** 取消一次 Device Observer 原生订阅；幂等，且不影响其他订阅者。 */
fun interface DeviceWindowObservationSubscription {
  fun cancel()
}

/** 仅描述 Device Observer 连接事实变化，不承载 RavenCat 业务语义。 */
data class DeviceObserverConnectionState(
  val connected: Boolean,
  val changedAtEpochMs: Long,
)

/**
 * Device Observer 原生多订阅者事件源。
 *
 * AccessibilityService 只向这里 publish 窗口与连接事实；Expo bridge、
 * 未来的 Device Control runtime 都是普通订阅者，互不覆盖。
 *
 * 这里只分发事实，不缓存事件（订阅前发生的事件不会补发），也不理解任何业务。
 */
object DeviceWindowObservationSource {
  private val windowSubscribers = CopyOnWriteArrayList<(DeviceWindowState) -> Unit>()
  private val connectionSubscribers =
    CopyOnWriteArrayList<(DeviceObserverConnectionState) -> Unit>()
  private val snapshotProvider = AtomicReference<(() -> DeviceWindowState?)?>(null)

  /** 订阅窗口事实；订阅方需自行配合 [currentWindowState] 读取初始快照。 */
  fun subscribeWindow(
    listener: (DeviceWindowState) -> Unit,
  ): DeviceWindowObservationSubscription {
    windowSubscribers.add(listener)
    return DeviceWindowObservationSubscription {
      windowSubscribers.remove(listener)
    }
  }

  /** 订阅连接事实变化。 */
  fun subscribeConnection(
    listener: (DeviceObserverConnectionState) -> Unit,
  ): DeviceWindowObservationSubscription {
    connectionSubscribers.add(listener)
    return DeviceWindowObservationSubscription {
      connectionSubscribers.remove(listener)
    }
  }

  /** 读取当前窗口快照；服务未连接时返回 unknown，不产生事件、不写诊断。 */
  fun currentWindowState(): DeviceWindowState {
    return snapshotProvider.get()?.invoke() ?: DeviceWindowState.unknown()
  }

  /** 由 AccessibilityService 在连接/断开时注册或清空快照读取入口。 */
  internal fun registerSnapshotProvider(provider: (() -> DeviceWindowState?)?) {
    snapshotProvider.set(provider)
  }

  internal fun publishWindowState(state: DeviceWindowState) {
    windowSubscribers.forEach { listener ->
      try {
        listener(state)
      } catch (error: Exception) {
        logDispatchFailure("window", error)
      }
    }
  }

  internal fun publishConnectionState(state: DeviceObserverConnectionState) {
    connectionSubscribers.forEach { listener ->
      try {
        listener(state)
      } catch (error: Exception) {
        logDispatchFailure("connection", error)
      }
    }
  }

  /**
   * 单个 subscriber 抛异常时记录并继续分发，保证一个失效 listener
   * 不会中断其他 subscriber，也不会把异常传播回 AccessibilityService 发布链。
   * 不重试、不自动取消订阅、不做业务兜底。
   */
  private fun logDispatchFailure(kind: String, error: Exception) {
    Logger.getLogger(DeviceWindowObservationSource::class.java.name).log(
      Level.SEVERE,
      "device observer $kind subscriber failed",
      error,
    )
  }
}
