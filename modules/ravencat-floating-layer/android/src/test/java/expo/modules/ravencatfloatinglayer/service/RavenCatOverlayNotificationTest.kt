package expo.modules.ravencatfloatinglayer.service

import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

/** 悬浮交互通知应回到自己的设置页，避免重新指向本地伴随入口。 */
@RunWith(RobolectricTestRunner::class)
class RavenCatOverlayNotificationTest {
  @Test
  fun `notification click opens floating interaction settings`() {
    val context = RuntimeEnvironment.getApplication()
    val notification = RavenCatOverlayNotification.build(context)

    notification.contentIntent.send()

    val launchedIntent = shadowOf(context).nextStartedActivity
    assertEquals(Intent.ACTION_VIEW, launchedIntent.action)
    assertEquals(
      Uri.parse("exp+kimiphone:///raven-cat/floating-interaction"),
      launchedIntent.data,
    )
    assertEquals(context.packageName, launchedIntent.`package`)
  }
}
