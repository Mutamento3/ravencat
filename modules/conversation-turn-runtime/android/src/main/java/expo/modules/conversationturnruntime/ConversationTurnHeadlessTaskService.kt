// 普通聊天 AI 回复执行的 Headless JS 宿主：以 Service 生命周期持有任务，不依赖 React 页面 runtime。
package expo.modules.conversationturnruntime

import android.content.Context
import android.content.Intent
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.pm.ServiceInfo
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise
import java.util.UUID

class ConversationTurnHeadlessTaskService : HeadlessJsTaskService() {
  private val handler = Handler(Looper.getMainLooper())
  private val hosts = linkedMapOf<String, Runnable>()
  private var foreground = false
  private lateinit var cpuLock: PowerManager.WakeLock

  override fun onCreate() {
    super.onCreate()
    cpuLock = (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RavenCat:ConversationTurn")
      .apply { setReferenceCounted(false) }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) return START_NOT_STICKY
    val id = checkNotNull(intent.getStringExtra("hostId"))
    try {
      if (!foreground) {
        ServiceCompat.startForeground(this, NOTIFICATION_ID, executionNotification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        foreground = true
      }
    } catch (error: RuntimeException) {
      Log.e(TAG, "execution_foreground_rejected hostId=$id", error)
      ConversationTurnHostLifetime.reject(id)
      if (hosts.isEmpty()) stopSelf(startId)
      return START_NOT_STICKY
    }
    // 迟到的 Service 启动不能在启动回执已经超时后偷偷执行模型。
    if (!ConversationTurnHostLifetime.accept(id)) {
      if (hosts.isEmpty()) stopSelf(startId)
      return START_NOT_STICKY
    }
    val startedAt = SystemClock.elapsedRealtime()
    val timeout = Runnable {
      Log.w(TAG, "execution_host_timeout hostId=$id elapsedMs=${SystemClock.elapsedRealtime() - startedAt}")
      ConversationTurnHostLifetime.stop(id, "execution_host_timeout")
    }
    hosts[id] = timeout
    handler.postDelayed(timeout, ConversationTurnHostLifetime.EXECUTION_TIMEOUT_MS)
    // RN 的进程级非计数锁会被其他 Headless Service 释放；本服务独立持有有界 CPU 锁。
    cpuLock.acquire(TASK_TIMEOUT_MS)
    handler.postDelayed({
      if (hosts.containsKey(id)) {
        ConversationTurnHostLifetime.stop(id, "execution_host_timeout")
        hosts.remove(id)
        if (hosts.isEmpty()) stopSelf()
      }
    }, TASK_TIMEOUT_MS)
    Log.i(TAG, "execution_foreground_started hostId=$id")
    super.onStartCommand(intent, flags, startId)
    // 恢复输入属于 ConversationTurn Repository；不让 Android 重投旧 Intent 重放工具。
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    for ((id, timeout) in hosts) {
      handler.removeCallbacks(timeout)
      ConversationTurnHostLifetime.stop(id, "execution_host_destroyed")
    }
    hosts.clear()
    handler.removeCallbacksAndMessages(null)
    stopForeground(STOP_FOREGROUND_REMOVE)
    if (cpuLock.isHeld) cpuLock.release()
    super.onDestroy()
  }

  private fun executionNotification(): Notification {
    val channel = "chat_execution"
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
      NotificationChannel(channel, "聊天执行", NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) })
    val open = checkNotNull(packageManager.getLaunchIntentForPackage(packageName))
    return Notification.Builder(this, channel).setSmallIcon(android.R.drawable.stat_notify_sync)
      .setContentTitle("RavenCat 正在处理聊天请求").setContentText("本次任务结束后自动关闭")
      .setOngoing(true).setShowWhen(false)
      .setContentIntent(PendingIntent.getActivity(this, 8608, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
      .build()
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      if (intent.action == HOST_RELATIONSHIP_ACTION) HOST_RELATIONSHIP_TASK_KEY else TASK_KEY,
      Arguments.fromBundle(extras),
      TASK_TIMEOUT_MS,
      true,
    )
  }

  companion object {
    private const val TAG = "ConversationTurnService"
    const val TASK_KEY = "ConversationTurnExecutionTask"
    private const val HOST_RELATIONSHIP_TASK_KEY = "HostRelationshipReplyTask"
    private const val HOST_RELATIONSHIP_ACTION = "ravencat.host_relationship_reply"
    private const val TASK_TIMEOUT_MS = 600_000L
    private const val NOTIFICATION_ID = 8608

    /** 用户操作只启动一次有界回复，模型与工具仍走已有 Chat 流程。 */
    fun startHostRelationshipReply(context: Context, aiId: String, change: String, occurredAt: String, promise: Promise) {
      val intent = Intent(context, ConversationTurnHeadlessTaskService::class.java).apply {
        action = HOST_RELATIONSHIP_ACTION
        putExtra("aiId", aiId)
        putExtra("change", change)
        putExtra("occurredAt", occurredAt)
      }
      requestStart(context, intent, promise)
    }

    /** 启动对话轮次执行任务；失败时保留 pending 事实，等待后续 host/recovery 接管，不做页面兜底。 */
    fun start(
      context: Context,
      sessionIds: List<String>,
      correlationId: String?,
      deliveryTiming: String?,
      promise: Promise,
    ) {
      val intent = Intent(context, ConversationTurnHeadlessTaskService::class.java).apply {
        putStringArrayListExtra("sessionIds", ArrayList(sessionIds))
        putExtra("correlationId", correlationId)
        putExtra("deliveryTiming", deliveryTiming)
        putExtra("createdAtEpochMs", System.currentTimeMillis().toDouble())
      }

      requestStart(context, intent, promise)
    }

    private fun requestStart(context: Context, intent: Intent, promise: Promise) {
      val id = UUID.randomUUID().toString()
      intent.putExtra("hostId", id)
      ConversationTurnHostLifetime.request(id, promise)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: RuntimeException) {
        Log.e(TAG, "start ConversationTurnHeadlessTaskService failed", e)
        ConversationTurnHostLifetime.reject(id)
      }
    }
  }
}
