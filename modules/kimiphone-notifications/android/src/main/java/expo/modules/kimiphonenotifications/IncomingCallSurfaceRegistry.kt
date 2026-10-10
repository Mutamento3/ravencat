package expo.modules.kimiphonenotifications

import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

/**
 * 当前展示中的原生来电 surface 登记表：callId -> 弱引用 Activity。
 * 只负责 UI surface 生命周期：业务层（Calls Runtime）结束通话时会撤销来电通知，
 * NotificationPublisher.dismissIncomingCall 同步调用 dismiss(callId) 关闭对应 Activity。
 * 这里不读业务状态、不做超时判定，不构成第二套通话状态机。
 */
internal object IncomingCallSurfaceRegistry {
  private val surfaces = ConcurrentHashMap<String, WeakReference<IncomingCallActivity>>()

  fun register(callId: String, activity: IncomingCallActivity) {
    surfaces[callId] = WeakReference(activity)
  }

  fun unregister(callId: String, activity: IncomingCallActivity) {
    // 只在仍指向同一个 Activity 时移除，避免误删新来电注册的 surface。
    val current = surfaces[callId] ?: return
    if (current.get() === activity) {
      surfaces.remove(callId, current)
    }
  }

  fun dismiss(callId: String) {
    surfaces.remove(callId)?.get()?.finish()
  }
}
