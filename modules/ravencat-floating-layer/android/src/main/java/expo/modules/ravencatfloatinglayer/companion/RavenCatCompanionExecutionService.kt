package expo.modules.ravencatfloatinglayer.companion

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import expo.modules.androidoverlayruntime.OverlayLaunchIntentFactory

/**
 * 一次 wake 执行的有界前台执行宿主。
 *
 * 所有权：Proactive Companion execution host（`RavenCatCompanionExecutionHost`）。
 *
 * 生命周期只由正在执行的 wake delivery 决定：每次执行开始前登记，执行收口后释放；
 * 最后一条 delivery 释放时 Service 立即停止。它不是产品开关的常驻服务，
 * 也不属于 Floating Interaction：Overlay FGS 的存亡与它无关，反之亦然。
 *
 * 不同日程可能同时有多条 delivery 在执行，
 * 因此这里按 delivery 计数：任何一条收口都不得提前移除另一条的执行保障。
 */
class RavenCatCompanionExecutionService : Service() {
  private val activeDeliveries = linkedSetOf<String>()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val deliveryEventId = intent
      ?.getStringExtra(EXTRA_DELIVERY_EVENT_ID)
      ?.takeIf { it.isNotBlank() }
    if (intent?.action == ACTION_RELEASE_EXECUTION) {
      releaseExecution(deliveryEventId)
      return START_NOT_STICKY
    }
    if (deliveryEventId == null) {
      stopSelf()
      return START_NOT_STICKY
    }

    activeDeliveries.add(deliveryEventId)
    return try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        RavenCatCompanionExecutionNotification.build(this, intent),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
      isForegroundRunning = true
      Log.i(TAG, "companion_execution_foreground_started deliveryEventId=$deliveryEventId")
      START_NOT_STICKY
    } catch (error: RuntimeException) {
      // Android 12+ 的后台启动限制可能在 startForeground 这一层才拒绝（不只是 startForegroundService）。
      // 这是执行质量的降级而不是执行失败：立即收尾，让 execution host 继续以普通后台执行完成本次 wake。
      Log.w(TAG, "companion_execution_foreground_rejected", error)
      activeDeliveries.remove(deliveryEventId)
      stopSelf()
      START_NOT_STICKY
    }
  }

  private fun releaseExecution(deliveryEventId: String?) {
    if (deliveryEventId != null) activeDeliveries.remove(deliveryEventId)
    if (activeDeliveries.isNotEmpty()) return
    Log.i(TAG, "companion_execution_foreground_stopped")
    stopForeground(STOP_FOREGROUND_REMOVE)
    isForegroundRunning = false
    stopSelf()
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    activeDeliveries.clear()
    isForegroundRunning = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    private const val TAG = "RavenCatCompanionWake"
    private const val NOTIFICATION_ID = 8607

    internal const val ACTION_EXECUTE = "expo.modules.ravencatfloatinglayer.action.EXECUTE"
    internal const val ACTION_RELEASE_EXECUTION =
      "expo.modules.ravencatfloatinglayer.action.RELEASE_COMPANION_EXECUTION"

    internal const val EXTRA_DELIVERY_EVENT_ID = "deliveryEventId"
    internal const val EXTRA_CONTEXT = "executionContext"

    @Volatile
    var isForegroundRunning: Boolean = false
      private set

    /**
     * 由 execution host 在即将把 wake 交给 Headless JS 前调用。
     *
     * 平台拒绝后台启动前台服务时返回 false：这是执行质量的降级，不是执行失败，
     * 调用方必须继续完成本次 wake，而不是让主动行动丢失。
     */
    fun start(context: Context, deliveryEventId: String, executionContext: String): Boolean {
      return try {
        ContextCompat.startForegroundService(
          context,
          executionIntent(context, deliveryEventId, executionContext, ACTION_EXECUTE),
        )
        // 注意：true 只表示 startForegroundService 请求已被系统接受；
        // startForeground 是否真正成功由 Service.onStartCommand 内的日志与
        // `isForegroundRunning` 表达，宿主在收口时读取该真值做诊断。
        true
      } catch (error: RuntimeException) {
        Log.w(TAG, "companion_execution_foreground_start_request_failed", error)
        false
      }
    }

    /** 释放指定 delivery 的执行保障；只有它是最后一条时 Service 才停止。 */
    fun stop(context: Context, deliveryEventId: String) {
      try {
        context.startService(
          executionIntent(context, deliveryEventId, executionContext = null, action = ACTION_RELEASE_EXECUTION),
        )
      } catch (error: RuntimeException) {
        // Service 已经不存在（例如前台执行曾被平台拒绝）时无需再释放。
        Log.w(TAG, "companion_execution_foreground_release_failed", error)
      }
    }

    /** Service intent 的唯一构造入口：action 决定本次是登记执行还是释放执行。 */
    internal fun executionIntent(
      context: Context,
      deliveryEventId: String,
      executionContext: String?,
      action: String,
    ): Intent = Intent(context, RavenCatCompanionExecutionService::class.java)
      .setAction(action)
      .putExtra(EXTRA_DELIVERY_EVENT_ID, deliveryEventId)
      .putExtra(EXTRA_CONTEXT, executionContext)
  }
}

/** 执行通知只表达「一次主动行动正在执行」；渠道随执行首次建立。 */
internal object RavenCatCompanionExecutionNotification {
  private const val CHANNEL_ID = "ravencat_companion_execution"
  private const val PROACTIVE_LIFE_DEEP_LINK = "exp+kimiphone:///raven-cat/proactive-life"

  fun build(context: Context, intent: Intent?): Notification {
    ensureChannel(context)
    val description = intent
      ?.getStringExtra(RavenCatCompanionExecutionService.EXTRA_CONTEXT)
      ?.takeIf { it.isNotBlank() }
    val smallIcon = context.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.stat_notify_sync
    return Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle("RavenCat 正在执行一次主动行动")
      .setContentText(description ?: "执行结束后自动关闭")
      .setOngoing(true)
      .setShowWhen(false)
      .setContentIntent(
        OverlayLaunchIntentFactory.createPendingIntent(
          context = context,
          target = Uri.parse(PROACTIVE_LIFE_DEEP_LINK),
        ),
      )
      .build()
  }

  private fun ensureChannel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "RavenCat 主动行动执行",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "RavenCat 正在后台完成一次主动行动，执行结束后自动关闭"
        setShowBadge(false)
      },
    )
  }
}
