package expo.modules.kimiphonenotifications

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationChannelGroup
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color

internal object NotificationChannelRegistry {
  const val MESSAGE_CHANNEL_ID = "ai_reply_v3_native"
  const val INCOMING_CALL_CHANNEL_ID = "ai_incoming_calls_v2_native"
  const val TOGETHER_LISTENING_CHANNEL_ID = "together_listening_live_v1"
  const val MESSAGE_GROUP_ID = "kimiphone_messages"
  val vibrationPattern = longArrayOf(250L, 200L, 250L, 200L)

  fun ensureChannels(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannelGroup(
      NotificationChannelGroup(MESSAGE_GROUP_ID, "KimiPhone 消息"),
    )
    manager.createNotificationChannel(
      NotificationChannel(
        MESSAGE_CHANNEL_ID,
        "AI 消息提醒",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "KimiPhone 会话消息通知"
        group = MESSAGE_GROUP_ID
        enableVibration(true)
        vibrationPattern = NotificationChannelRegistry.vibrationPattern
        enableLights(true)
        lightColor = Color.rgb(58, 155, 239)
        setShowBadge(true)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        INCOMING_CALL_CHANNEL_ID,
        "AI 视频电话",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "KimiPhone AI 视频来电通知"
        group = MESSAGE_GROUP_ID
        // 显式声明锁屏可见；已在用户设备上创建的 Channel 不会被代码覆盖（Android 语义），
        // 用户/OEM 改动以系统设置页为准，排障读 lockscreenVisibility() 的实际值。
        setLockscreenVisibility(Notification.VISIBILITY_PUBLIC)
        enableVibration(true)
        vibrationPattern = NotificationChannelRegistry.vibrationPattern
        enableLights(true)
        lightColor = Color.rgb(58, 155, 239)
        setShowBadge(true)
      },
    )
    manager.createNotificationChannel(
      NotificationChannel(
        TOGETHER_LISTENING_CHANNEL_ID,
        "一起听",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Together Listening 持续活动"
        setLockscreenVisibility(Notification.VISIBILITY_PRIVATE)
        enableVibration(false)
        setSound(null, null)
        enableLights(false)
        setShowBadge(false)
      },
    )
  }

  fun importance(context: Context, channelId: String): Int {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.getNotificationChannel(channelId)?.importance ?: 0
  }

  /** 实际 Channel 的锁屏可见性（VISIBILITY_PUBLIC/PRIVATE/SECRET）；Channel 缺失时返回 null 而不是伪造值。 */
  fun lockscreenVisibility(context: Context, channelId: String): Int? {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return manager.getNotificationChannel(channelId)?.lockscreenVisibility
  }
}
