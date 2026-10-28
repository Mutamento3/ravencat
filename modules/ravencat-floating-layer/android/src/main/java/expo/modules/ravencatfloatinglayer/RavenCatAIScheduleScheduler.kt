package expo.modules.ravencatfloatinglayer

import android.content.Context
import android.util.Log
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionExecutionHost
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionExecutionOutcome
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionWakeDispatcher
import org.json.JSONObject
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlin.math.max

/**
 * 单条 AI Schedule 的 keyed native projection（执行镜像）。
 *
 * 每条 scheduleId 拥有独立 Alarm 与 OneTimeWork，二者汇入同一执行 gate。
 * 原生只保存可重建的执行副本，SQLite 仍是业务真值。
 */
internal data class RavenCatAIScheduleProjection(
  val scheduleId: String,
  val ownerAIId: String,
  val expectedRemindAtEpochMs: Long,
  val projectionToken: String,
)

/** 轻量 projection registry；记录可重建镜像，不创建或修改业务事实。 */
internal object RavenCatAIScheduleStore {
  private const val PREFS_NAME = "ravencat_ai_schedule_scheduler"
  private const val KEY_PREFIX = "projection:"

  fun isEnabled(context: Context): Boolean = prefs(context).getBoolean("enabled", false)

  fun setEnabled(context: Context, enabled: Boolean) {
    check(prefs(context).edit().putBoolean("enabled", enabled).commit()) {
      "主动伴随开关镜像持久化失败"
    }
  }

  @Synchronized
  fun put(context: Context, projection: RavenCatAIScheduleProjection) {
    val json = JSONObject()
      .put("ownerAIId", projection.ownerAIId)
      .put("expectedRemindAtEpochMs", projection.expectedRemindAtEpochMs)
      .put("projectionToken", projection.projectionToken)
    check(prefs(context).edit().putString(KEY_PREFIX + projection.scheduleId, json.toString()).commit()) {
      "AI Schedule projection registry 持久化失败"
    }
  }

  @Synchronized
  fun remove(context: Context, scheduleId: String) {
    check(prefs(context).edit().remove(KEY_PREFIX + scheduleId).commit()) {
      "AI Schedule projection 消费持久化失败"
    }
  }

  @Synchronized
  fun get(context: Context, scheduleId: String): RavenCatAIScheduleProjection? {
    val json = prefs(context).getString(KEY_PREFIX + scheduleId, null) ?: return null
    return decode(scheduleId, json)
  }

  @Synchronized
  fun list(context: Context): List<RavenCatAIScheduleProjection> {
    val all = prefs(context).all
    return all.keys
      .filter { it.startsWith(KEY_PREFIX) }
      .mapNotNull { key -> decode(key.removePrefix(KEY_PREFIX), all[key] as? String) }
      .sortedBy { it.scheduleId }
  }

  fun clearAllForFactoryReset(context: Context) {
    check(prefs(context).edit().clear().commit()) {
      "无法清空 RavenCat AI Schedule scheduler state"
    }
  }

  private fun decode(scheduleId: String, raw: String?): RavenCatAIScheduleProjection? {
    if (raw == null) return null
    val json = JSONObject(raw)
    return RavenCatAIScheduleProjection(
      scheduleId = scheduleId,
      ownerAIId = json.getString("ownerAIId"),
      expectedRemindAtEpochMs = json.getLong("expectedRemindAtEpochMs"),
      projectionToken = json.getString("projectionToken"),
    )
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}

/** 维护 keyed OneTimeWork；每条 scheduleId 独立、统一 tag、REPLACE 更新。 */
internal object RavenCatAIScheduleWorkScheduler {
  const val WORK_TAG = "ravencat_ai_schedule"
  private const val UNIQUE_PREFIX = "ravencat_ai_schedule_"
  private const val EVENT_ID_KEY = "eventId"
  private const val OWNER_AI_ID_KEY = "ownerAIId"
  private const val EXPECTED_REMIND_AT_KEY = "expectedRemindAtEpochMs"
  private const val PROJECTION_TOKEN_KEY = "projectionToken"

  private val SAFE_ID = Regex("^[A-Za-z0-9._-]{1,80}$")

  @Synchronized
  fun scheduleTrigger(context: Context, projection: RavenCatAIScheduleProjection, immediate: Boolean = false) {
    require(projection.expectedRemindAtEpochMs > 0L) { "AI Schedule expectedRemindAtEpochMs 非法" }
    require(projection.scheduleId.isNotBlank()) { "AI Schedule scheduleId 不能为空" }
    require(projection.ownerAIId.isNotBlank()) { "AI Schedule ownerAIId 不能为空" }
    require(projection.projectionToken.isNotBlank()) { "AI Schedule projectionToken 不能为空" }

    val data = Data.Builder()
      .putString(EVENT_ID_KEY, projection.scheduleId)
      .putString(OWNER_AI_ID_KEY, projection.ownerAIId)
      .putLong(EXPECTED_REMIND_AT_KEY, projection.expectedRemindAtEpochMs)
      .putString(PROJECTION_TOKEN_KEY, projection.projectionToken)
      .build()
    // 已 due 的 remindAt 以 delay=0 立即执行；durable remindAt 不被修改。
    val request = OneTimeWorkRequestBuilder<RavenCatAIScheduleWorker>()
      .setInitialDelay(if (immediate) 0L else delayUntil(projection.expectedRemindAtEpochMs), TimeUnit.MILLISECONDS)
      .setInputData(data)
      .addTag(WORK_TAG)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(
      uniqueWorkName(projection.scheduleId),
      ExistingWorkPolicy.REPLACE,
      request,
    ).result.get()
  }

  @Synchronized
  fun cancelTrigger(context: Context, scheduleId: String) {
    WorkManager.getInstance(context)
      .cancelUniqueWork(uniqueWorkName(scheduleId))
      .result
      .get()
  }

  @Synchronized
  fun cancelAll(context: Context) {
    WorkManager.getInstance(context)
      .cancelAllWorkByTag(WORK_TAG)
      .result
      .get()
  }

  private fun delayUntil(epochMs: Long) = max(0L, epochMs - System.currentTimeMillis())

  /** scheduleId 不是合法 raw work name 时退化为稳定哈希，避免非法 / 超长 identity。 */
  internal fun uniqueWorkName(scheduleId: String): String {
    if (SAFE_ID.matches(scheduleId)) return UNIQUE_PREFIX + scheduleId
    val digest = MessageDigest.getInstance("SHA-256")
      .digest(scheduleId.toByteArray(Charsets.UTF_8))
      .joinToString("") { "%02x".format(it) }
    return UNIQUE_PREFIX + digest.take(32)
  }
}

/** 单个 `scheduleId@projectionToken` delivery 的消费结果；只有 [CONSUMED] 允许进入执行宿主。 */
internal enum class RavenCatAIScheduleConsumeOutcome {
  /** 本次 delivery 是当前投影的唯一 winner：已撤销投影并取得执行权。 */
  CONSUMED,

  /** 投影仍在，但版本不匹配（已被 update/cancel 后的新投影取代）：本次投递已过期。 */
  STALE,

  /** 该 scheduleId 当前没有投影（已消费过 / 已取消 / 从未调度）：没有可执行的 delivery。 */
  ABSENT,
}

/**
 * AI Schedule keyed projection facade：registry 与 WorkManager 镜像协调。
 * 不拥有业务真值；所有投递都必须消费同一 keyed projection。
 */
internal object RavenCatAIScheduleScheduler {
  /** 开关镜像先落盘，迟到 Worker 无法 dispatch；只取消未消费投影，不中断已取得执行权的 run。 */
  @Synchronized
  fun setEnabled(context: Context, enabled: Boolean) {
    retireLegacySelfWakeProjection(context)
    RavenCatAIScheduleStore.setEnabled(context, enabled)
    if (!enabled) {
      RavenCatAIScheduleStore.list(context).forEach { cancel(context, it.scheduleId) }
    } else {
      restoreFutureAlarms(context)
    }
  }

  @Synchronized
  fun schedule(context: Context, projection: RavenCatAIScheduleProjection): RavenCatAIScheduleProjection {
    check(RavenCatAIScheduleStore.isEnabled(context)) { "主动伴随关闭时不能建立日程投影" }
    RavenCatAIScheduleStore.put(context, projection)
    try {
      RavenCatAIScheduleWorkScheduler.scheduleTrigger(context, projection)
      RavenCatAIScheduleAlarmScheduler.schedule(context, projection)
      RavenCatCompanionWakeStore.recordScheduleDiagnostic(context,
        "${projection.scheduleId}@${projection.projectionToken}", AIScheduleDiagnosticStage.PROJECTION_ARMED,
        projection.expectedRemindAtEpochMs)
    } catch (error: Exception) {
      RavenCatAIScheduleStore.remove(context, projection.scheduleId)
      throw error
    }
    return projection
  }

  @Synchronized
  fun cancel(context: Context, scheduleId: String) {
    RavenCatAIScheduleStore.remove(context, scheduleId)
    RavenCatAIScheduleAlarmScheduler.cancel(context, scheduleId)
    RavenCatAIScheduleWorkScheduler.cancelTrigger(context, scheduleId)
  }

  fun list(context: Context): List<RavenCatAIScheduleProjection> =
    RavenCatAIScheduleStore.list(context)

  /**
   * 只有版本完全匹配才清镜像并取得执行权；这也是 AI Schedule delivery 的唯一 native gate。
   *
   * 消费者必须拿到明确的 winner 结论；WorkManager 重复投递 / 进程重建后的重新执行
   * 会带着同一个 `scheduleId@projectionToken` 再次进入 execution host。
   *
   * 投影已消失（已消费 / 已取消）→ [RavenCatAIScheduleConsumeOutcome.ABSENT]；
   * 版本不匹配（被新投影取代）→ [RavenCatAIScheduleConsumeOutcome.STALE]，
   * 且绝不触碰新投影。
   */
  @Synchronized
  fun consumeDueTriggerIfCurrent(
    context: Context,
    scheduleId: String,
    expectedRemindAtEpochMs: Long,
    projectionToken: String,
  ): RavenCatAIScheduleConsumeOutcome {
    if (!RavenCatAIScheduleStore.isEnabled(context)) return RavenCatAIScheduleConsumeOutcome.ABSENT
    val current = RavenCatAIScheduleStore.get(context, scheduleId)
      ?: return RavenCatAIScheduleConsumeOutcome.ABSENT
    if (
      current.expectedRemindAtEpochMs != expectedRemindAtEpochMs
      || current.projectionToken != projectionToken
    ) {
      return RavenCatAIScheduleConsumeOutcome.STALE
    }
    RavenCatAIScheduleStore.remove(context, scheduleId)
    RavenCatAIScheduleAlarmScheduler.cancel(context, scheduleId)
    return RavenCatAIScheduleConsumeOutcome.CONSUMED
  }

  /** 与 Worker 消费在同一锁内串行；过期 Alarm 不能替换已在执行的新 Work。 */
  @Synchronized
  fun enqueueFromAlarm(context: Context, scheduleId: String, expectedAt: Long, token: String) {
    if (!RavenCatAIScheduleStore.isEnabled(context)) return
    val current = RavenCatAIScheduleStore.get(context, scheduleId) ?: return
    if (current.expectedRemindAtEpochMs != expectedAt || current.projectionToken != token) return
    RavenCatAIScheduleWorkScheduler.scheduleTrigger(context, current, immediate = true)
    RavenCatCompanionWakeStore.recordScheduleDiagnostic(context, "$scheduleId@$token",
      AIScheduleDiagnosticStage.ALARM_WORK_ENQUEUED, expectedAt)
  }

  @Synchronized
  fun restoreFutureAlarms(context: Context) {
    if (!RavenCatAIScheduleStore.isEnabled(context)) return
    RavenCatAIScheduleStore.list(context)
      .filter { it.expectedRemindAtEpochMs > System.currentTimeMillis() }
      .forEach { RavenCatAIScheduleAlarmScheduler.schedule(context, it) }
  }

  fun clearStoredStateForFactoryReset(context: Context) {
    RavenCatAIScheduleStore.list(context).forEach { RavenCatAIScheduleAlarmScheduler.cancel(context, it.scheduleId) }
    RavenCatAIScheduleWorkScheduler.cancelAll(context)
    RavenCatAIScheduleStore.clearAllForFactoryReset(context)
  }
}

/**
 * 到期时只传递该 scheduleId 的 durable 版本身份，不拥有业务队列状态。
 *
 * 进入 execution host 前必须通过 native gate（`consumeDueTriggerIfCurrent`）：
 * 只有它判定本次 `scheduleId@projectionToken` 是当前投影的 winner，才算一次真正的
 * delivery；重复投递 / 进程重建只能是 ABSENT 或 STALE。
 */
class RavenCatAIScheduleWorker(
  appContext: Context,
  params: WorkerParameters,
) : Worker(appContext, params) {
  override fun doWork(): Result {
    val scheduleId = inputData.getString("eventId")?.takeIf { it.isNotBlank() }
      ?: return Result.failure()
    val ownerAIId = inputData.getString("ownerAIId")?.takeIf { it.isNotBlank() }
      ?: return Result.failure()
    val expectedRemindAt = inputData.getLong("expectedRemindAtEpochMs", -1L)
    val projectionToken = inputData.getString("projectionToken")?.takeIf { it.isNotBlank() }
      ?: return Result.failure()
    if (expectedRemindAt < 0L) return Result.failure()

    RavenCatCompanionWakeStore.recordScheduleDiagnostic(applicationContext, "$scheduleId@$projectionToken",
      AIScheduleDiagnosticStage.WORKER_STARTED, expectedRemindAt)

    // native gate：只有当前投影的 winner 才能进入执行宿主。
    // STALE / ABSENT（已 update / 已 cancel / 已被更早的投递消费）都直接收口，
    // 同一个 delivery 不会因为 WorkManager 重复投递或进程重建再执行一次。
    when (
      RavenCatAIScheduleScheduler.consumeDueTriggerIfCurrent(
        applicationContext,
        scheduleId,
        expectedRemindAt,
        projectionToken,
      )
    ) {
      RavenCatAIScheduleConsumeOutcome.STALE -> {
        RavenCatCompanionWakeStore.recordScheduleDiagnostic(applicationContext, "$scheduleId@$projectionToken",
          AIScheduleDiagnosticStage.GATE_REJECTED, expectedRemindAt, "STALE")
        Log.i(TAG, "AI Schedule stale worker ignored scheduleId=$scheduleId")
        return Result.success()
      }
      RavenCatAIScheduleConsumeOutcome.ABSENT -> {
        RavenCatCompanionWakeStore.recordScheduleDiagnostic(applicationContext, "$scheduleId@$projectionToken",
          AIScheduleDiagnosticStage.GATE_REJECTED, expectedRemindAt, "ABSENT")
        Log.i(TAG, "AI Schedule delivery already consumed scheduleId=$scheduleId")
        return Result.success()
      }
      RavenCatAIScheduleConsumeOutcome.CONSUMED -> Unit
    }
    Log.i(TAG, "ai_schedule_worker_started scheduleId=$scheduleId")
    val dispatch = RavenCatCompanionWakeDispatcher.prepare(
      context = applicationContext,
      wakeReason = "system_timer",
      source = "work-manager",
      eventId = scheduleId,
      scheduleRevision = -1L,
      hostAIId = ownerAIId,
      triggerKind = "ai_schedule",
      expectedRemindAtEpochMs = expectedRemindAt,
      projectionToken = projectionToken,
    ) ?: return Result.success()
    // 与 Self Wake 共用同一个 execution host：一次 delivery 的执行生命周期只由一个 owner 持有。
    return when (RavenCatCompanionExecutionHost.execute(applicationContext, dispatch)) {
      RavenCatCompanionExecutionOutcome.COMPLETED -> Result.success()
      RavenCatCompanionExecutionOutcome.START_REJECTED,
      RavenCatCompanionExecutionOutcome.TIMED_OUT,
      RavenCatCompanionExecutionOutcome.WORKER_STOPPED,
      -> Result.failure()
    }
  }

  private companion object {
    const val TAG = "RavenCatCompanionWake"
  }
}
