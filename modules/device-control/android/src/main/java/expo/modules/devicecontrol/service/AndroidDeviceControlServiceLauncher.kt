package expo.modules.devicecontrol.service

import android.app.ForegroundServiceStartNotAllowedException
import android.content.Context
import android.content.Intent
import expo.modules.devicecontrol.runtime.DeviceControlServiceStartRequestResult

/** Android Service 启动边界；把系统后台启动限制映射成稳定 typed result。 */
class AndroidDeviceControlServiceLauncher(
  private val applicationContext: Context,
) {
  fun requestStart(serviceGeneration: Long): DeviceControlServiceStartRequestResult {
    val serviceIntent = Intent(applicationContext, DeviceControlService::class.java)
    serviceIntent.putExtra(
      DeviceControlService.EXTRA_SERVICE_GENERATION,
      serviceGeneration,
    )
    return requestStart(serviceIntent)
  }

  internal fun requestStart(serviceIntent: Intent): DeviceControlServiceStartRequestResult {
    return try {
      applicationContext.startForegroundService(serviceIntent)
      DeviceControlServiceStartRequestResult.Accepted
    } catch (error: ForegroundServiceStartNotAllowedException) {
      DeviceControlServiceStartRequestResult.BackgroundRestricted(
        error.message ?: "Android 不允许从当前后台状态首次启动 Device Control Service",
      )
    } catch (error: RuntimeException) {
      DeviceControlServiceStartRequestResult.Failed(
        error.message ?: "无法请求启动 Device Control Service",
      )
    }
  }

}
