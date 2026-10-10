package expo.modules.ravencatfloatinglayer.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import expo.modules.androidoverlayruntime.OverlayLaunchIntentFactory

/** RavenCat Overlay Service 的通知渠道与通知构建。 */
internal object RavenCatOverlayNotification {
  const val NOTIFICATION_ID = 8606

  /**
   * 已发布的渠道 ID 保持原值：Android 通知渠道 ID 一旦发布就不能迁移，
   * 换 ID 会让用户已有的渠道设置（重要性、静音）失效。这个名字只表示历史遗留，
   * 渠道的显示名与描述已经是悬浮交互语义。
   */
  private const val LEGACY_CHANNEL_ID = "ravencat_companion_mode"
  private const val SETTINGS_DEEP_LINK = "exp+kimiphone:///raven-cat/floating-interaction"

  fun build(context: Context): Notification {
    ensureChannel(context)
    val contentIntent = OverlayLaunchIntentFactory.createPendingIntent(
      context = context,
      target = Uri.parse(SETTINGS_DEEP_LINK),
    )
    val smallIcon = context.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.stat_notify_sync
    return Notification.Builder(context, LEGACY_CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle("KimiPhone 悬浮交互")
      .setContentText("RavenCat 悬浮球正在运行")
      .setOngoing(true)
      .setShowWhen(false)
      .setContentIntent(contentIntent)
      .build()
  }

  private fun ensureChannel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        LEGACY_CHANNEL_ID,
        "RavenCat 悬浮交互",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "KimiPhone 悬浮球正在运行"
        setShowBadge(false)
      },
    )
  }
}
