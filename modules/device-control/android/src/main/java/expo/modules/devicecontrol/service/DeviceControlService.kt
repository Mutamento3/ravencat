package expo.modules.devicecontrol.service

import android.app.ForegroundServiceStartNotAllowedException
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.ServiceCompat
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.runtime.DeviceControlServiceStopRequester
import expo.modules.devicecontrol.runtime.ProcessDeviceControlRuntimeHost

/** 同一 Service 实例可接收多次 start；每次 stop owner 永久绑定 Android 分配的 startId。 */
internal class DeviceControlServiceStartOwnership(
  private val serviceGeneration: Long,
  private val startId: Int,
  private val stopSelf: (Int) -> Unit,
) : DeviceControlServiceStopRequester {
  override fun requestStop(serviceGeneration: Long): Boolean {
    if (serviceGeneration != this.serviceGeneration) {
      return false
    }
    stopSelf(startId)
    return true
  }
}

/** Service 实例只记录 Host 接受的最新 generation；stale Intent 不能覆盖 destroy ownership。 */
internal class DeviceControlServiceInstanceOwnership {
  private var latestAcceptedGeneration: Long? = null

  fun accept(
    serviceGeneration: Long,
    ownsGeneration: (Long) -> Boolean,
  ): Boolean {
    if (!ownsGeneration(serviceGeneration)) {
      return false
    }
    latestAcceptedGeneration = serviceGeneration
    return true
  }

  fun generationForDestroy(): Long? = latestAcceptedGeneration
}

/**
 * Device Control 独立前台 Service。
 *
 * 只拥有 Android component/foreground 生命周期、独立通知与 process host attach/detach；
 * 不读取 SQLite、不决定 active lock、不触碰 Floating Interaction、Chat 或 AI。
 */
class DeviceControlService : Service() {
  private val instanceOwnership = DeviceControlServiceInstanceOwnership()

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val generation = requireNotNull(intent).getLongExtra(
      EXTRA_SERVICE_GENERATION,
      NO_SERVICE_GENERATION,
    )
    require(generation != NO_SERVICE_GENERATION)
    if (
      !instanceOwnership.accept(
        serviceGeneration = generation,
        ownsGeneration = ProcessDeviceControlRuntimeHost::ownsServiceGeneration,
      )
    ) {
      stopSelf(startId)
      return START_MODE
    }

    return try {
      ServiceCompat.startForeground(
        this,
        DeviceControlNotification.NOTIFICATION_ID,
        DeviceControlNotification.build(this),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
      )
      val ownership = DeviceControlServiceStartOwnership(
        serviceGeneration = generation,
        startId = startId,
        stopSelf = { ownedStartId -> stopSelf(ownedStartId) },
      )
      if (!ProcessDeviceControlRuntimeHost.onServiceStarted(this, generation, ownership)) {
        stopSelf(startId)
      }
      START_MODE
    } catch (error: ForegroundServiceStartNotAllowedException) {
      failForegroundPromotion(
        code = SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
        reason = error.message ?: "Android 不允许当前后台状态启动 Device Control 前台服务",
        serviceGeneration = generation,
        startId = startId,
      )
    } catch (error: RuntimeException) {
      failForegroundPromotion(
        code = SoftLockFailureCode.SERVICE_START_FAILED,
        reason = error.message ?: "Device Control Service 无法进入前台",
        serviceGeneration = generation,
        startId = startId,
      )
    }
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    instanceOwnership.generationForDestroy()
      ?.let(ProcessDeviceControlRuntimeHost::onServiceDestroyed)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun failForegroundPromotion(
    code: SoftLockFailureCode,
    reason: String,
    serviceGeneration: Long,
    startId: Int,
  ): Int {
    ProcessDeviceControlRuntimeHost.onServicePromotionFailed(
      serviceGeneration,
      code,
      reason,
    )
    stopSelf(startId)
    return START_MODE
  }

  companion object {
    /** 进程重启后不恢复旧投影，必须等待 application 重新 reconcile。 */
    const val START_MODE = START_NOT_STICKY
    const val EXTRA_SERVICE_GENERATION =
      "expo.modules.devicecontrol.extra.SERVICE_GENERATION"
    private const val NO_SERVICE_GENERATION = Long.MIN_VALUE
  }
}
