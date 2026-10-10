package expo.modules.ravencatfloatinglayer.companion

import android.app.Service
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.content.Intent
import expo.modules.ravencatfloatinglayer.service.RavenCatOverlayService
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService

/**
 * 平台拒绝建立前台执行（`startForeground` 阶段抛
 * `ForegroundServiceStartNotAllowedException`，Android 12+ 真机行为）时：
 * Service 必须自行收尾、不得崩溃，执行宿主继续以普通后台执行完成本次 wake。
 */
@RunWith(RobolectricTestRunner::class)
@Config(shadows = [ForegroundDeniedShadowService::class])
class RavenCatCompanionExecutionServiceForegroundDeniedTest {
  private val context = RuntimeEnvironment.getApplication()

  @Test
  fun `startForeground denial degrades without crash and keeps foreground state false`() {
    assertFalse(RavenCatOverlayService.isRunning)
    val controller = Robolectric
      .buildService(RavenCatCompanionExecutionService::class.java)
      .create()

    controller.withIntent(executeIntent("wake-denied")).startCommand(0, 0)

    assertFalse(
      "startForeground 被平台拒绝时不得伪装成前台执行已建立",
      RavenCatCompanionExecutionService.isForegroundRunning,
    )

    // 迟到的释放请求在服务未建立时必须是安全 no-op。
    controller.withIntent(releaseIntent("wake-denied")).startCommand(0, 0)
    assertFalse(RavenCatCompanionExecutionService.isForegroundRunning)
  }

  private fun executeIntent(deliveryEventId: String) = Intent(
    context,
    RavenCatCompanionExecutionService::class.java,
  )
    .setAction(RavenCatCompanionExecutionService.ACTION_EXECUTE)
    .putExtra(RavenCatCompanionExecutionService.EXTRA_DELIVERY_EVENT_ID, deliveryEventId)
    .putExtra(RavenCatCompanionExecutionService.EXTRA_CONTEXT, "正在执行一次 self wake")

  private fun releaseIntent(deliveryEventId: String) = Intent(
    context,
    RavenCatCompanionExecutionService::class.java,
  )
    .setAction(RavenCatCompanionExecutionService.ACTION_RELEASE_EXECUTION)
    .putExtra(RavenCatCompanionExecutionService.EXTRA_DELIVERY_EVENT_ID, deliveryEventId)
}

/** 模拟 Android 12+ 在 `startForeground` 阶段拒绝后台前台启动。 */
@Implements(Service::class)
class ForegroundDeniedShadowService : ShadowService() {
  @Implementation
  override fun startForeground(id: Int, notification: Notification) {
    throw ForegroundServiceStartNotAllowedException("startForeground not allowed")
  }

  @Implementation
  override fun startForeground(id: Int, notification: Notification, foregroundServiceType: Int) {
    throw ForegroundServiceStartNotAllowedException("startForeground not allowed")
  }
}
