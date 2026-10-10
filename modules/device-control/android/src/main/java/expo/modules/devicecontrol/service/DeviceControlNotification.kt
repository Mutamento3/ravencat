package expo.modules.devicecontrol.service

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import expo.modules.androidoverlayruntime.OverlayLaunchIntentFactory

/** Device Control Service 独立通知；不复用 Floating Interaction 产品语义。 */
internal object DeviceControlNotification {
  const val NOTIFICATION_ID = 8612
  private const val CHANNEL_ID = "ravencat_device_control"
  private const val RAVEN_CAT_DEEP_LINK = "exp+kimiphone:///raven-cat"

  fun build(context: Context): Notification {
    ensureChannel(context)
    val contentIntent = OverlayLaunchIntentFactory.createPendingIntent(
      context = context,
      target = Uri.parse(RAVEN_CAT_DEEP_LINK),
    )
    val smallIcon = context.applicationInfo.icon.takeIf { it != 0 }
      ?: android.R.drawable.stat_notify_sync
    return Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle("RavenCat 设备控制")
      .setContentText("RavenCat 设备控制正在运行")
      .setOngoing(true)
      .setShowWhen(false)
      .setContentIntent(contentIntent)
      .build()
  }

  private fun ensureChannel(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "RavenCat 设备控制",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "RavenCat 临时设备控制正在运行"
        setShowBadge(false)
      },
    )
  }
}
