package expo.modules.ravencatfloatinglayer

import android.content.Context
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionWakeDispatcher
import org.json.JSONArray
import org.json.JSONObject

data class RavenCatCompanionWakeEvent(
  val wakeReason: String,
  val source: String,
  val eventId: String,
  val createdAtEpochMs: Long,
  val scheduleRevision: Long = -1L,
  val hostAIId: String? = null,
  val triggerKind: String? = null,
  val expectedRemindAtEpochMs: Long? = null,
  val projectionToken: String? = null,
  val deliveryEventId: String? = null,
)

internal data class RavenCatCompanionWakeStatus(
  val lastNativeWakeAtEpochMs: Long,
  val lastNativeWakeReason: String?,
  val lastNativeWakeSource: String?,
  val lastNativeWakeBridgeConnected: Boolean,
  val lastHeadlessTaskStartAtEpochMs: Long,
  val lastHeadlessTaskStartAccepted: Boolean,
  val lastHeadlessTaskStartError: String?,
  val lastRunnerCompletionAtEpochMs: Long,
  /** 最近一次 runner 终态回执的 delivery identity（不是 resolved eventId）。 */
  val lastRunnerCompletionDeliveryEventId: String?,
  val lastRunnerCompletionSucceeded: Boolean,
  val lastRunnerCompletionError: String?,
  val lastExecutionAtEpochMs: Long,
  val lastExecutionOutcome: String?,
  val lastExecutionDeliveryEventId: String?,
  val lastExecutionForegroundRunning: Boolean,
  val pendingNativeWakeCount: Int,
  val lastPendingWakeAtEpochMs: Long,
)

internal object RavenCatCompanionWakeStore {
  private const val PREFS_NAME = "ravencat_companion_wake_store"
  private const val KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS = "lastNativeWakeAtEpochMs"
  private const val KEY_LAST_NATIVE_WAKE_REASON = "lastNativeWakeReason"
  private const val KEY_LAST_NATIVE_WAKE_SOURCE = "lastNativeWakeSource"
  private const val KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED = "lastNativeWakeBridgeConnected"
  private const val KEY_LAST_HEADLESS_TASK_START_AT_EPOCH_MS = "lastHeadlessTaskStartAtEpochMs"
  private const val KEY_LAST_HEADLESS_TASK_START_ACCEPTED = "lastHeadlessTaskStartAccepted"
  private const val KEY_LAST_HEADLESS_TASK_START_ERROR = "lastHeadlessTaskStartError"
  private const val KEY_LAST_RUNNER_COMPLETION_AT_EPOCH_MS = "lastRunnerCompletionAtEpochMs"
  // legacy persisted key name：字符串必须保持原样，已安装设备的回执数据仍要可读。
  private const val KEY_LAST_RUNNER_COMPLETION_DELIVERY_EVENT_ID = "lastRunnerCompletionEventId"
  private const val KEY_LAST_RUNNER_COMPLETION_SUCCEEDED = "lastRunnerCompletionSucceeded"
  private const val KEY_LAST_RUNNER_COMPLETION_ERROR = "lastRunnerCompletionError"
  private const val KEY_LAST_EXECUTION_AT_EPOCH_MS = "lastExecutionAtEpochMs"
  private const val KEY_LAST_EXECUTION_OUTCOME = "lastExecutionOutcome"
  private const val KEY_LAST_EXECUTION_DELIVERY_EVENT_ID = "lastExecutionDeliveryEventId"
  private const val KEY_LAST_EXECUTION_FOREGROUND_RUNNING = "lastExecutionForegroundRunning"
  // 同上：legacy persisted key name，值是 completion ring 里的 delivery identity。
  private const val KEY_RECENT_RUNNER_COMPLETION_DELIVERY_IDS = "recentRunnerCompletionEventIds"
  private const val KEY_PENDING_NATIVE_WAKE_COUNT = "pendingNativeWakeCount"
  private const val KEY_LAST_PENDING_WAKE_AT_EPOCH_MS = "lastPendingWakeAtEpochMs"
  private const val KEY_PENDING_QUEUE = "pendingWakeQueue"

  fun status(context: Context): RavenCatCompanionWakeStatus {
    val prefs = prefs(context)
    return RavenCatCompanionWakeStatus(
      lastNativeWakeAtEpochMs = prefs.getLong(KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS, 0L),
      lastNativeWakeReason = prefs.getString(KEY_LAST_NATIVE_WAKE_REASON, null),
      lastNativeWakeSource = prefs.getString(KEY_LAST_NATIVE_WAKE_SOURCE, null),
      lastNativeWakeBridgeConnected = prefs.getBoolean(
        KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED,
        false,
      ),
      lastHeadlessTaskStartAtEpochMs = prefs.getLong(
        KEY_LAST_HEADLESS_TASK_START_AT_EPOCH_MS,
        0L,
      ),
      lastHeadlessTaskStartAccepted = prefs.getBoolean(
        KEY_LAST_HEADLESS_TASK_START_ACCEPTED,
        false,
      ),
      lastHeadlessTaskStartError = prefs.getString(KEY_LAST_HEADLESS_TASK_START_ERROR, null),
      lastRunnerCompletionAtEpochMs = prefs.getLong(
        KEY_LAST_RUNNER_COMPLETION_AT_EPOCH_MS,
        0L,
      ),
      lastRunnerCompletionDeliveryEventId = prefs.getString(
        KEY_LAST_RUNNER_COMPLETION_DELIVERY_EVENT_ID,
        null,
      ),
      lastRunnerCompletionSucceeded = prefs.getBoolean(
        KEY_LAST_RUNNER_COMPLETION_SUCCEEDED,
        false,
      ),
      lastRunnerCompletionError = prefs.getString(KEY_LAST_RUNNER_COMPLETION_ERROR, null),
      lastExecutionAtEpochMs = prefs.getLong(KEY_LAST_EXECUTION_AT_EPOCH_MS, 0L),
      lastExecutionOutcome = prefs.getString(KEY_LAST_EXECUTION_OUTCOME, null),
      lastExecutionDeliveryEventId = prefs.getString(KEY_LAST_EXECUTION_DELIVERY_EVENT_ID, null),
      lastExecutionForegroundRunning = prefs.getBoolean(KEY_LAST_EXECUTION_FOREGROUND_RUNNING, false),
      pendingNativeWakeCount = prefs.getInt(KEY_PENDING_NATIVE_WAKE_COUNT, 0),
      lastPendingWakeAtEpochMs = prefs.getLong(KEY_LAST_PENDING_WAKE_AT_EPOCH_MS, 0L),
    )
  }

  fun recordHeadlessTaskStartRequested(
    context: Context,
    event: RavenCatCompanionWakeEvent,
  ) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS, event.createdAtEpochMs)
      .putString(KEY_LAST_NATIVE_WAKE_REASON, event.wakeReason)
      .putString(KEY_LAST_NATIVE_WAKE_SOURCE, event.source)
      .putBoolean(KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED, false)
      .putLong(KEY_LAST_HEADLESS_TASK_START_AT_EPOCH_MS, System.currentTimeMillis())
      .putBoolean(KEY_LAST_HEADLESS_TASK_START_ACCEPTED, false)
      .remove(KEY_LAST_HEADLESS_TASK_START_ERROR)
      .apply()
  }

  fun recordHeadlessTaskStartAccepted(
    context: Context,
    event: RavenCatCompanionWakeEvent,
  ) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS, event.createdAtEpochMs)
      .putString(KEY_LAST_NATIVE_WAKE_REASON, event.wakeReason)
      .putString(KEY_LAST_NATIVE_WAKE_SOURCE, event.source)
      .putBoolean(KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED, true)
      .putLong(KEY_LAST_HEADLESS_TASK_START_AT_EPOCH_MS, System.currentTimeMillis())
      .putBoolean(KEY_LAST_HEADLESS_TASK_START_ACCEPTED, true)
      .remove(KEY_LAST_HEADLESS_TASK_START_ERROR)
      .apply()
  }

  fun recordHeadlessTaskStartFailed(
    context: Context,
    event: RavenCatCompanionWakeEvent,
    error: String,
  ) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS, event.createdAtEpochMs)
      .putString(KEY_LAST_NATIVE_WAKE_REASON, event.wakeReason)
      .putString(KEY_LAST_NATIVE_WAKE_SOURCE, event.source)
      .putBoolean(KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED, false)
      .putLong(KEY_LAST_HEADLESS_TASK_START_AT_EPOCH_MS, System.currentTimeMillis())
      .putBoolean(KEY_LAST_HEADLESS_TASK_START_ACCEPTED, false)
      .putString(KEY_LAST_HEADLESS_TASK_START_ERROR, error)
      .apply()
  }

  @Synchronized
  fun recordPending(context: Context, event: RavenCatCompanionWakeEvent) {
    val prefs = prefs(context)
    // 按 delivery identity 去重：同一 projection 的重复 start failure 只保留最新一份，
    // 避免填满队列挤掉其他 schedule。
    val incomingId = event.deliveryId()
    val queue = readPendingQueue(prefs)
      .filter { raw -> deliveryIdOfRaw(raw) != incomingId }
      .toMutableList()
      .also { it.add(event.toJson().toString()) }
    val bounded = queue.takeLast(MAX_PENDING_WAKE_EVENTS)
    prefs
      .edit()
      .putLong(KEY_LAST_NATIVE_WAKE_AT_EPOCH_MS, event.createdAtEpochMs)
      .putString(KEY_LAST_NATIVE_WAKE_REASON, event.wakeReason)
      .putString(KEY_LAST_NATIVE_WAKE_SOURCE, event.source)
      .putBoolean(KEY_LAST_NATIVE_WAKE_BRIDGE_CONNECTED, false)
      .putInt(KEY_PENDING_NATIVE_WAKE_COUNT, bounded.size)
      .putLong(KEY_LAST_PENDING_WAKE_AT_EPOCH_MS, event.createdAtEpochMs)
      .putString(KEY_PENDING_QUEUE, JSONArray(bounded).toString())
      .commit()
  }

  /**
   * 写入 runner 终态回执。
   *
   * key 必须是 delivery identity（AI Schedule 为 `eventId@projectionToken`），不能用
   * resolved `eventId` 顶替：completion ring 去重与 execution host 的完成信号都按这个
   * identity 比对，错一个就同时失配。
   */
  @Synchronized
  fun recordRunnerCompletion(
    context: Context,
    deliveryEventId: String,
    succeeded: Boolean,
    error: String?,
  ) {
    val prefs = prefs(context)
    // 只有成功结案才允许去重；失败保留系统重投递作为恢复路径（租约过期后由 JS 重试）。
    val recentIds = if (succeeded) {
      RavenCatCompanionCompletionRing.append(
        prefs.getString(KEY_RECENT_RUNNER_COMPLETION_DELIVERY_IDS, null),
        deliveryEventId,
      )
    } else {
      prefs.getString(KEY_RECENT_RUNNER_COMPLETION_DELIVERY_IDS, null)
    }
    prefs
      .edit()
      .putLong(KEY_LAST_RUNNER_COMPLETION_AT_EPOCH_MS, System.currentTimeMillis())
      .putString(KEY_LAST_RUNNER_COMPLETION_DELIVERY_EVENT_ID, deliveryEventId)
      .putBoolean(KEY_LAST_RUNNER_COMPLETION_SUCCEEDED, succeeded)
      .putString(KEY_LAST_RUNNER_COMPLETION_ERROR, error)
      .putString(KEY_RECENT_RUNNER_COMPLETION_DELIVERY_IDS, recentIds)
      .apply()
  }

  /**
   * 记录一次 execution host 的收口结果。
   *
   * 这是执行宿主自己的诊断事实，不改变 wake 业务状态：`TIMED_OUT` 只表示宿主在
   * 有界等待（含取消宽限）内没有收到 runner 终态，不代表 wake 可以被重跑。
   * `foregroundRunning` 是收口时刻前台执行的真实状态，
   * 与「startForegroundService 请求已被接受」是两回事。
   */
  @Synchronized
  fun recordExecutionOutcome(
    context: Context,
    deliveryEventId: String,
    outcome: String,
    foregroundRunning: Boolean,
  ) {
    prefs(context)
      .edit()
      .putLong(KEY_LAST_EXECUTION_AT_EPOCH_MS, System.currentTimeMillis())
      .putString(KEY_LAST_EXECUTION_OUTCOME, outcome)
      .putString(KEY_LAST_EXECUTION_DELIVERY_EVENT_ID, deliveryEventId)
      .putBoolean(KEY_LAST_EXECUTION_FOREGROUND_RUNNING, foregroundRunning)
      .apply()
  }

  /**
   * 标记一次 delivery 已被执行宿主请求取消。
   *
   * 取消事实必须由「拥有 execution identity 的 native 层」持有，不能只放在 JS 内存里：
   * Headless runner 可能晚于取消请求才注册自己的 `AbortController`（JS 冷启动、
   * runtime 重建、任务尚未派发），纯 JS Map 会把这次取消静默丢掉。
   *
   * 因此标记必须活到 runner 主动 [consumeExecutionCancellation] 为止，**任何人都不主动
   * 删除它**（包括执行宿主收口）。它唯一的消亡方式是：被 runner 消费一次，或 TTL 剪枝。
   * `deliveryEventId` 就是 delivery identity，同一个 id 的再次执行是同一个 delivery，
   * 不是一个「全新执行」，不复位取消事实。
   */
  @Synchronized
  fun markExecutionCancellationRequested(context: Context, deliveryEventId: String) {
    val prefs = prefs(context)
    val now = System.currentTimeMillis()
    val editor = prefs.edit().putLong(cancellationKey(deliveryEventId), now)
    pruneExpiredCancellationMarkers(prefs, editor, now)
    check(editor.commit()) { "无法持久化 Companion 执行取消标记" }
  }

  /**
   * runner 启动后主动消费本次 delivery 的取消标记（一次性）。
   *
   * 返回 true 表示「取消早于 runner 注册，迟到注册必须立刻追平」。
   */
  @Synchronized
  fun consumeExecutionCancellation(context: Context, deliveryEventId: String): Boolean {
    val prefs = prefs(context)
    val key = cancellationKey(deliveryEventId)
    if (!prefs.contains(key)) return false
    check(prefs.edit().remove(key).commit()) { "无法消费 Companion 执行取消标记" }
    return true
  }

  /** 该 delivery identity 的唤醒是否已有完成回执；用于拦截系统的重复投递。 */
  @Synchronized
  fun hasRecentRunnerCompletion(context: Context, deliveryEventId: String): Boolean {
    return RavenCatCompanionCompletionRing.contains(
      prefs(context).getString(KEY_RECENT_RUNNER_COMPLETION_DELIVERY_IDS, null),
      deliveryEventId,
    )
  }

  /** 恢复出厂：清空全部 wake 状态，防止 pending wake 在新 listener 连上后被消费。 */
  @Synchronized
  fun clearAllForFactoryReset(context: Context) {
    check(prefs(context).edit().clear().commit()) {
      "无法清空 RavenCat wake store"
    }
  }

  @Synchronized
  fun consumeAllPending(context: Context): List<RavenCatCompanionWakeEvent> {
    val prefs = prefs(context)
    val queue = readPendingQueue(prefs)
    if (queue.isEmpty()) return emptyList()
    prefs
      .edit()
      .putInt(KEY_PENDING_NATIVE_WAKE_COUNT, 0)
      .remove(KEY_PENDING_QUEUE)
      .commit()
    return queue.mapNotNull { raw ->
      try {
        decodeEvent(JSONObject(raw))
      } catch (error: Exception) {
        null
      }
    }
  }

  private fun cancellationKey(deliveryEventId: String) =
    "$KEY_EXECUTION_CANCELLATION_PREFIX$deliveryEventId"

  /**
   * 剪掉长期无人消费的取消标记。
   *
   * 标记只在「宿主已请求取消 → runner 消费」之间有意义；runner 始终没出现的
   * delivery 会留下孤儿 key，不剪枝会让 SharedPreferences 随 wake 次数无限增长。
   */
  private fun pruneExpiredCancellationMarkers(
    prefs: android.content.SharedPreferences,
    editor: android.content.SharedPreferences.Editor,
    now: Long,
  ) {
    prefs.all.keys
      .filter { it.startsWith(KEY_EXECUTION_CANCELLATION_PREFIX) }
      .filter { key ->
        val markedAt = prefs.getLong(key, 0L)
        markedAt <= 0L || now - markedAt > CANCELLATION_MARKER_TTL_MS
      }
      .forEach(editor::remove)
  }

  private fun readPendingQueue(prefs: android.content.SharedPreferences): List<String> {
    val raw = prefs.getString(KEY_PENDING_QUEUE, null) ?: return emptyList()
    if (raw.isBlank()) return emptyList()
    return try {
      val array = JSONArray(raw)
      (0 until array.length()).mapNotNull { index -> array.optString(index).takeIf { it.isNotBlank() } }
    } catch (error: Exception) {
      emptyList()
    }
  }

  private fun RavenCatCompanionWakeEvent.deliveryId(): String =
    deliveryEventId?.takeIf { it.isNotBlank() } ?: eventId

  private fun deliveryIdOfRaw(raw: String): String? {
    return try {
      val json = JSONObject(raw)
      json.optString("deliveryEventId").takeIf { it.isNotBlank() }
        ?: json.optString("eventId").takeIf { it.isNotBlank() }
    } catch (error: Exception) {
      null
    }
  }

  private fun RavenCatCompanionWakeEvent.toJson(): JSONObject {
    return JSONObject()
      .put("wakeReason", wakeReason)
      .put("source", source)
      .put("eventId", eventId)
      .put("createdAtEpochMs", createdAtEpochMs)
      .put("scheduleRevision", scheduleRevision)
      .put("hostAIId", hostAIId ?: "")
      .put("triggerKind", triggerKind ?: "")
      .put("expectedRemindAtEpochMs", expectedRemindAtEpochMs ?: -1L)
      .put("projectionToken", projectionToken ?: "")
      .put("deliveryEventId", deliveryEventId ?: "")
  }

  private fun decodeEvent(json: JSONObject): RavenCatCompanionWakeEvent? {
    val eventId = json.optString("eventId").takeIf { it.isNotBlank() }
      ?: return null
    return RavenCatCompanionWakeEvent(
      wakeReason = json.optString("wakeReason").ifBlank { "system_timer" },
      source = json.optString("source").ifBlank { "companion-service-pending" },
      eventId = eventId,
      createdAtEpochMs = json.optLong("createdAtEpochMs", System.currentTimeMillis()),
      scheduleRevision = json.optLong("scheduleRevision", -1L),
      hostAIId = json.optString("hostAIId").takeIf { it.isNotBlank() },
      triggerKind = json.optString("triggerKind").takeIf { it.isNotBlank() },
      expectedRemindAtEpochMs = json.optLong("expectedRemindAtEpochMs", -1L).takeIf { it >= 0L },
      projectionToken = json.optString("projectionToken").takeIf { it.isNotBlank() },
      deliveryEventId = json.optString("deliveryEventId").takeIf { it.isNotBlank() },
    )
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private const val MAX_PENDING_WAKE_EVENTS = 16
  private const val KEY_EXECUTION_CANCELLATION_PREFIX = "executionCancellation:"
  private const val CANCELLATION_MARKER_TTL_MS = 24 * 60 * 60 * 1000L
}
