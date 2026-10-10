package expo.modules.devicecontrol.runtime

import android.content.Context
import expo.modules.androidoverlayruntime.OverlayPermissionGateway
import expo.modules.devicecontrol.controller.SoftLockWindowOwner
import expo.modules.devicecontrol.model.DeviceControlRuntimeStartResult
import expo.modules.devicecontrol.model.DeviceControlRuntimeState
import expo.modules.devicecontrol.model.DeviceControlRuntimeStopResult
import expo.modules.devicecontrol.model.DeviceControlRuntimeStopStatus
import expo.modules.devicecontrol.model.SoftLockCommand
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockReconcileResult
import expo.modules.devicecontrol.service.AndroidDeviceControlServiceLauncher
import expo.modules.devicecontrol.view.AndroidSoftLockWindowHost

private data class ProcessDeviceControlServiceStopOwner(
  val serviceGeneration: Long,
  val stopRequester: DeviceControlServiceStopRequester,
)

/**
 * Android 进程唯一 Device Control host registry。
 *
 * applicationContext 只在首次启动时用于构造一份 Window owner/runtime；Expo bridge
 * 重建与 Service lifecycle 之后都复用同一个 delegate，不创建第二份 observer/timer/window owner。
 */
object ProcessDeviceControlRuntimeHost {
  private val stateLock = Any()
  private var delegate: DeviceControlRuntimeHost? = null
  private var serviceStopOwner: ProcessDeviceControlServiceStopOwner? = null

  fun startRuntime(context: Context): DeviceControlRuntimeStartResult {
    val applicationContext = context.applicationContext
    return host(applicationContext).startRuntime(
      AndroidDeviceControlServiceLauncher(applicationContext)::requestStart,
    )
  }

  fun reconcile(command: SoftLockCommand): SoftLockReconcileResult {
    return synchronized(stateLock) { delegate }
      ?.reconcile(command)
      ?: SoftLockReconcileResult.runtimeUnavailable("device control runtime 尚未启动")
  }

  fun runtimeState(): DeviceControlRuntimeState {
    return synchronized(stateLock) { delegate }
      ?.runtimeState()
      ?: DeviceControlRuntimeState(
        serviceRunning = false,
        softLock = expo.modules.devicecontrol.model.SoftLockRuntimeState.detached(),
      )
  }

  fun stopRuntimeIfIdle(): DeviceControlRuntimeStopResult {
    val current = synchronized(stateLock) { delegate }
      ?: return DeviceControlRuntimeStopResult(
        status = DeviceControlRuntimeStopStatus.ALREADY_STOPPED,
      )
    return current.stopRuntimeIfIdle(::requestServiceStop)
  }

  fun ownsServiceGeneration(serviceGeneration: Long): Boolean {
    return synchronized(stateLock) { delegate }
      ?.ownsServiceGeneration(serviceGeneration)
      ?: false
  }

  fun onServiceStarted(
    context: Context,
    serviceGeneration: Long,
    stopRequester: DeviceControlServiceStopRequester,
  ): Boolean {
    val accepted = host(context.applicationContext).onServiceStarted(serviceGeneration)
    if (accepted) {
      synchronized(stateLock) {
        serviceStopOwner = ProcessDeviceControlServiceStopOwner(
          serviceGeneration = serviceGeneration,
          stopRequester = stopRequester,
        )
      }
    }
    return accepted
  }

  fun onServicePromotionFailed(
    serviceGeneration: Long,
    code: SoftLockFailureCode,
    reason: String,
  ) {
    synchronized(stateLock) { delegate }
      ?.onServicePromotionFailed(serviceGeneration, code, reason)
  }

  fun onServiceDestroyed(serviceGeneration: Long) {
    val current = synchronized(stateLock) {
      if (serviceStopOwner?.serviceGeneration == serviceGeneration) {
        serviceStopOwner = null
      }
      delegate
    }
    current?.onServiceDestroyed(serviceGeneration)
  }

  private fun requestServiceStop(serviceGeneration: Long): Boolean {
    // Service 可能尚未收到对应 onStartCommand；Host 已撤销 ownership，晚到请求会自行 stopSelf(startId)。
    val owner = synchronized(stateLock) { serviceStopOwner }
      ?: return true
    if (owner.serviceGeneration != serviceGeneration) {
      return false
    }

    val accepted = owner.stopRequester.requestStop(serviceGeneration)
    if (accepted) {
      synchronized(stateLock) {
        if (serviceStopOwner === owner) {
          serviceStopOwner = null
        }
      }
    }
    return accepted
  }

  private fun host(applicationContext: Context): DeviceControlRuntimeHost {
    return synchronized(stateLock) {
      delegate ?: DeviceControlRuntimeHost {
        SoftLockRuntime(
          windowOwner = SoftLockWindowOwner(
            windowHost = AndroidSoftLockWindowHost(applicationContext),
            overlayPermissionGranted = {
              OverlayPermissionGateway.isGranted(applicationContext)
            },
          ),
          mainThreadExecutor = AndroidSoftLockMainThreadExecutor(),
          expiryScheduler = AndroidSoftLockExpiryScheduler(),
        )
      }.also { delegate = it }
    }
  }
}
