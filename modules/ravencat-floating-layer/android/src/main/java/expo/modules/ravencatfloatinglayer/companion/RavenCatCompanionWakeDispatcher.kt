package expo.modules.ravencatfloatinglayer.companion

import android.content.Context
import android.util.Log
import expo.modules.ravencatfloatinglayer.RavenCatCompanionWakeEvent
import expo.modules.ravencatfloatinglayer.RavenCatCompanionWakeStore
import java.util.UUID

internal typealias RavenCatCompanionWakeListener = (event: RavenCatCompanionWakeEvent) -> Unit

/** 一次 wake delivery 交给 JS 执行的完整身份。 */
internal data class RavenCatCompanionWakeDispatch(
  val event: RavenCatCompanionWakeEvent,
  val deliveryEventId: String,
)

/**
 * 组装 wake delivery 身份，并维护进程内 JS 观察者。
 *
 * 它不拥有执行生命周期：真正的后台执行由 `RavenCatCompanionExecutionHost` 持有。
 * 它也不依赖悬浮 Service 的存活状态。
 */
internal object RavenCatCompanionWakeDispatcher {
  @Volatile
  private var listener: RavenCatCompanionWakeListener? = null

  /** execution host 超时收口 → JS runner 取消请求的原生→JS 通道（由 bridge 注册）。 */
  @Volatile
  private var executionCancelListener: ((deliveryEventId: String) -> Unit)? = null

  val isBridgeConnected: Boolean
    get() = listener != null

  fun setListener(context: Context?, nextListener: RavenCatCompanionWakeListener?) {
    listener = nextListener
    if (context != null && nextListener != null) {
      RavenCatCompanionWakeStore.consumeAllPending(context).forEach(nextListener)
    }
  }

  fun setExecutionCancelListener(nextListener: ((deliveryEventId: String) -> Unit)?) {
    executionCancelListener = nextListener
  }

  /**
   * 组装一次 delivery 身份。
   *
   * 返回 null 表示该 delivery 已有完成回执：系统重投递（START_REDELIVER_INTENT、
   * 进程重建）不得再触发一次完整的 JS 冷启动。delivery identity 必须包含
   * projection version：AI Schedule 用 `scheduleId@projectionToken`，避免 stale v1
   * callback 的 completion 毒死 update 后的 v2 callback。
   */
  fun prepare(
    context: Context,
    wakeReason: String,
    source: String,
    eventId: String? = null,
    scheduleRevision: Long = -1L,
    hostAIId: String? = null,
    triggerKind: String? = null,
    expectedRemindAtEpochMs: Long? = null,
    projectionToken: String? = null,
  ): RavenCatCompanionWakeDispatch? {
    val resolvedEventId = eventId ?: buildEventId()
    val deliveryEventId = buildDeliveryEventId(resolvedEventId, triggerKind, projectionToken)
    if (RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, deliveryEventId)) {
      Log.i(TAG, "主动唤醒 deliveryEventId=$deliveryEventId 已有完成回执，忽略系统重复投递")
      return null
    }
    return RavenCatCompanionWakeDispatch(
      event = RavenCatCompanionWakeEvent(
        wakeReason = wakeReason,
        source = source,
        eventId = resolvedEventId,
        createdAtEpochMs = System.currentTimeMillis(),
        scheduleRevision = scheduleRevision,
        hostAIId = hostAIId,
        triggerKind = triggerKind,
        expectedRemindAtEpochMs = expectedRemindAtEpochMs,
        projectionToken = projectionToken,
        deliveryEventId = deliveryEventId,
      ),
      deliveryEventId = deliveryEventId,
    )
  }

  /** 通知进程内 JS 观察者；它只是附加观察面，不参与执行结果判定。 */
  fun notifyBridge(event: RavenCatCompanionWakeEvent) {
    listener?.invoke(event)
  }

  /** 请求 JS runner 取消当前 delivery 的执行；没有注册通道时是 no-op（宿主仍按有界等待收口）。 */
  fun notifyExecutionCancel(deliveryEventId: String) {
    executionCancelListener?.invoke(deliveryEventId)
  }

  fun buildEventId(): String = "ravencat_contact_wake_${UUID.randomUUID()}"

  private fun buildDeliveryEventId(
    eventId: String,
    triggerKind: String?,
    projectionToken: String?,
  ): String {
    return if (triggerKind == "ai_schedule" && !projectionToken.isNullOrBlank()) {
      "$eventId@$projectionToken"
    } else {
      eventId
    }
  }

  private const val TAG = "RavenCatCompanionWake"
}
