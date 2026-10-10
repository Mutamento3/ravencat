package expo.modules.kimiphonenotifications

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class NotificationDiagnosticsTest {
  @Test
  fun `diagnostics do not create or delete system channels`() {
    val context = RuntimeEnvironment.getApplication()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val previous = NotificationChannel("ai_reply_v2_high", "保留的用户配置", NotificationManager.IMPORTANCE_LOW)
    manager.createNotificationChannel(previous)
    val before = manager.notificationChannels.map { it.id }.toSet()
    val result = NotificationPublisher.permissionStatus(context)
    assertEquals(before, manager.notificationChannels.map { it.id }.toSet())
    assertEquals(0, result["messageChannelImportance"])
    assertEquals(NotificationManager.IMPORTANCE_LOW, manager.getNotificationChannel(previous.id).importance)
  }

  @Test
  fun `diagnostics report existing user channel settings`() {
    val context = RuntimeEnvironment.getApplication()
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(NotificationChannel(NotificationChannelRegistry.MESSAGE_CHANNEL_ID,
      "用户配置", NotificationManager.IMPORTANCE_LOW))
    assertEquals(NotificationManager.IMPORTANCE_LOW, NotificationPublisher.permissionStatus(context)["messageChannelImportance"])
  }
}
