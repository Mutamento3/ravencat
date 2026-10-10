package expo.modules.devicecontrol.service

import android.app.ForegroundServiceStartNotAllowedException
import android.content.ComponentName
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import expo.modules.devicecontrol.runtime.DeviceControlServiceStartRequestResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidDeviceControlServiceLauncherTest {
  @Test
  fun `allowed cold start returns accepted`() {
    var startCount = 0
    val context = TestServiceContext {
      startCount += 1
      ComponentName(PACKAGE_NAME, DeviceControlService::class.java.name)
    }
    val launcher = AndroidDeviceControlServiceLauncher(context)

    val result = launcher.requestStart(Intent(context, DeviceControlService::class.java))

    assertTrue(result is DeviceControlServiceStartRequestResult.Accepted)
    assertEquals(1, startCount)
    assertEquals(0, context.activityStartCount)
  }

  @Test
  fun `official foreground service restriction has dedicated result`() {
    var startCount = 0
    val context = TestServiceContext {
      startCount += 1
      throw ForegroundServiceStartNotAllowedException("background restricted")
    }
    val launcher = AndroidDeviceControlServiceLauncher(context)

    val result = launcher.requestStart(Intent(context, DeviceControlService::class.java))

    assertTrue(result is DeviceControlServiceStartRequestResult.BackgroundRestricted)
    assertTrue(
      (result as DeviceControlServiceStartRequestResult.BackgroundRestricted).reason.isNotBlank(),
    )
    assertEquals(1, startCount)
    assertEquals(0, context.activityStartCount)
  }

  @Test
  fun `security error is generic start failure instead of background restriction`() {
    var startCount = 0
    val context = TestServiceContext {
      startCount += 1
      throw SecurityException("missing permission")
    }
    val launcher = AndroidDeviceControlServiceLauncher(context)

    val result = launcher.requestStart(Intent(context, DeviceControlService::class.java))

    assertTrue(result is DeviceControlServiceStartRequestResult.Failed)
    assertEquals(
      "missing permission",
      (result as DeviceControlServiceStartRequestResult.Failed).reason,
    )
    assertEquals(1, startCount)
    assertEquals(0, context.activityStartCount)
  }

  private class TestServiceContext(
    private val start: (Intent) -> ComponentName?,
  ) : ContextWrapper(null) {
    var activityStartCount = 0
      private set

    override fun getApplicationContext(): Context = this

    override fun getPackageName(): String = PACKAGE_NAME

    override fun startForegroundService(service: Intent): ComponentName? = start(service)

    override fun startActivity(intent: Intent) {
      activityStartCount += 1
    }
  }

  private companion object {
    const val PACKAGE_NAME = "expo.modules.devicecontrol.test"
  }
}
