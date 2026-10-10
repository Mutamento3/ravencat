package expo.modules.devicecontrol.runtime

import expo.modules.devicecontrol.model.DeviceControlRuntimeStartResult
import expo.modules.devicecontrol.model.DeviceControlRuntimeStartStatus
import expo.modules.devicecontrol.model.DeviceControlRuntimeState
import expo.modules.devicecontrol.model.DeviceControlRuntimeStopResult
import expo.modules.devicecontrol.model.DeviceControlRuntimeStopStatus
import expo.modules.devicecontrol.model.SoftLockCommand
import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockReconcileResult
import expo.modules.devicecontrol.model.SoftLockRuntimeState

sealed interface DeviceControlServiceStartRequestResult {
  data object Accepted : DeviceControlServiceStartRequestResult

  data class BackgroundRestricted(val reason: String) : DeviceControlServiceStartRequestResult

  data class Failed(val reason: String) : DeviceControlServiceStartRequestResult
}

fun interface DeviceControlServiceStartRequester {
  fun requestStart(serviceGeneration: Long): DeviceControlServiceStartRequestResult
}

fun interface DeviceControlServiceStopRequester {
  fun requestStop(serviceGeneration: Long): Boolean
}

private data class DeviceControlServiceStopClaim(
  val serviceGeneration: Long,
  val wasRunning: Boolean,
  val wasStartRequested: Boolean,
)

/**
 * Device Control 的 process-scoped runtime owner。
 *
 * 一份 host 在进程内只创建一份 [SoftLockRuntimeHandle]；bridge 与 Android Service
 * 只转发 lifecycle command，不各自持有 runtime/window owner。Service 不参与投影内容，
 * application 仍只能通过 reconcile 整体替换业务真值的 native 投影。
 */
class DeviceControlRuntimeHost(
  private val runtimeFactory: () -> SoftLockRuntimeHandle,
) {
  private val stateLock = Any()
  private var runtime: SoftLockRuntimeHandle? = null
  private var nextServiceGeneration = 1L
  private var activeServiceGeneration: Long? = null
  private var stoppingServiceGeneration: Long? = null
  private var serviceRunning = false
  private var serviceStartRequested = false
  private var servicePromotionFailure: SoftLockFailure? = null
  private var lifecycleFailure: SoftLockFailure? = null

  /**
   * 可见 bridge 先同步 attach 唯一 runtime，再请求 FGS。
   * 因此方法返回 started 后，紧接着的 reconcile 不依赖 Service.onCreate 时序。
   */
  fun startRuntime(
    startRequester: DeviceControlServiceStartRequester,
  ): DeviceControlRuntimeStartResult {
    val serviceGeneration = try {
      synchronized(stateLock) {
        servicePromotionFailure?.let { failure ->
          return DeviceControlRuntimeStartResult(
            status = if (failure.code == SoftLockFailureCode.BACKGROUND_START_RESTRICTED) {
              DeviceControlRuntimeStartStatus.BACKGROUND_START_RESTRICTED
            } else {
              DeviceControlRuntimeStartStatus.FAILED
            },
            reason = failure.message,
          )
        }
        ensureAttachedLocked()
        if (
          activeServiceGeneration != null
          && (serviceRunning || serviceStartRequested)
        ) {
          return DeviceControlRuntimeStartResult(
            status = DeviceControlRuntimeStartStatus.ALREADY_RUNNING,
          )
        }
        val generation = nextServiceGeneration++
        activeServiceGeneration = generation
        serviceRunning = false
        serviceStartRequested = true
        lifecycleFailure = null
        generation
      }
    } catch (error: RuntimeException) {
      val reason = error.message ?: "Device Control runtime attach 失败"
      failStart(
        serviceGeneration = null,
        code = SoftLockFailureCode.SERVICE_START_FAILED,
        reason = reason,
      )
      return DeviceControlRuntimeStartResult(
        status = DeviceControlRuntimeStartStatus.FAILED,
        reason = reason,
      )
    }

    val requestResult = try {
      startRequester.requestStart(serviceGeneration)
    } catch (error: RuntimeException) {
      DeviceControlServiceStartRequestResult.Failed(
        error.message ?: "无法请求启动 Device Control Service",
      )
    }

    return when (requestResult) {
      DeviceControlServiceStartRequestResult.Accepted -> DeviceControlRuntimeStartResult(
        status = DeviceControlRuntimeStartStatus.STARTED,
      )

      is DeviceControlServiceStartRequestResult.BackgroundRestricted -> {
        failStart(
          serviceGeneration = serviceGeneration,
          code = SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
          reason = requestResult.reason,
        )
        DeviceControlRuntimeStartResult(
          status = DeviceControlRuntimeStartStatus.BACKGROUND_START_RESTRICTED,
          reason = requestResult.reason,
        )
      }

      is DeviceControlServiceStartRequestResult.Failed -> {
        failStart(
          serviceGeneration = serviceGeneration,
          code = SoftLockFailureCode.SERVICE_START_FAILED,
          reason = requestResult.reason,
        )
        DeviceControlRuntimeStartResult(
          status = DeviceControlRuntimeStartStatus.FAILED,
          reason = requestResult.reason,
        )
      }
    }
  }

  /** Service 只有持有当前 generation，才能确认自己已正式进入前台。 */
  fun onServiceStarted(serviceGeneration: Long): Boolean {
    return synchronized(stateLock) {
      if (serviceGeneration != activeServiceGeneration) {
        return@synchronized false
      }
      ensureAttachedLocked()
      serviceRunning = true
      serviceStartRequested = false
      servicePromotionFailure = null
      lifecycleFailure = null
      true
    }
  }

  fun ownsServiceGeneration(serviceGeneration: Long): Boolean {
    return synchronized(stateLock) {
      serviceGeneration == activeServiceGeneration
    }
  }

  /**
   * FGS promotion 失败后立即 fail-open detach，并在 Service 销毁前保留失败门闩。
   * 这段窗口既不是 running，也不能再次发起 cold start，否则旧 Service 的 onDestroy
   * 可能误拆掉新一轮 runtime。
   */
  fun onServicePromotionFailed(
    serviceGeneration: Long,
    code: SoftLockFailureCode,
    reason: String,
  ) {
    synchronized(stateLock) {
      if (serviceGeneration != activeServiceGeneration) {
        return
      }
      serviceRunning = false
      serviceStartRequested = false
      val failure = SoftLockFailure(code = code, message = reason)
      servicePromotionFailure = failure
      lifecycleFailure = failure
      runtime?.detach()
    }
  }

  /** 只有当前 generation 的销毁回调可以释放当前 runtime。 */
  fun onServiceDestroyed(serviceGeneration: Long) {
    synchronized(stateLock) {
      if (serviceGeneration == stoppingServiceGeneration) {
        stoppingServiceGeneration = null
      }
      if (serviceGeneration != activeServiceGeneration) {
        return
      }
      activeServiceGeneration = null
      serviceRunning = false
      serviceStartRequested = false
      servicePromotionFailure = null
      runtime?.detach()
    }
  }

  fun reconcile(command: SoftLockCommand): SoftLockReconcileResult {
    return synchronized(stateLock) {
      runtime?.reconcile(command)
        ?: SoftLockReconcileResult.runtimeUnavailable("device control runtime 尚未启动")
    }
  }

  /**
   * 只有 authoritative projection 已为空时才停止。
   * detach 会先清 window、expiry 与 observer subscription，再请求停止 Android Service。
   */
  fun stopRuntimeIfIdle(
    stopRequester: DeviceControlServiceStopRequester,
  ): DeviceControlRuntimeStopResult {
    val stopClaim = synchronized(stateLock) {
      val activeProjectionCount = runtime?.runtimeState()?.projectedLocks?.size ?: 0
      if (activeProjectionCount > 0) {
        return DeviceControlRuntimeStopResult(
          status = DeviceControlRuntimeStopStatus.STILL_ACTIVE,
          activeProjectionCount = activeProjectionCount,
          reason = "仍有 active soft lock projection",
        )
      }

      runtime?.detach()
      val lifecycleWasActive = activeServiceGeneration != null
        && (serviceRunning || serviceStartRequested)
      if (!lifecycleWasActive) {
        return@synchronized null
      }

      val generation = requireNotNull(activeServiceGeneration)
      val claim = DeviceControlServiceStopClaim(
        serviceGeneration = generation,
        wasRunning = serviceRunning,
        wasStartRequested = serviceStartRequested,
      )
      stoppingServiceGeneration = generation
      activeServiceGeneration = null
      serviceRunning = false
      serviceStartRequested = false
      claim
    }

    if (stopClaim === null) {
      return DeviceControlRuntimeStopResult(
        status = DeviceControlRuntimeStopStatus.ALREADY_STOPPED,
      )
    }

    val stopped = try {
      stopRequester.requestStop(stopClaim.serviceGeneration)
    } catch (error: RuntimeException) {
      return stopFailed(
        claim = stopClaim,
        reason = error.message ?: "无法停止 Device Control Service",
      )
    }
    if (!stopped) {
      return stopFailed(
        claim = stopClaim,
        reason = "Android 未接受 Device Control Service 停止请求",
      )
    }

    return DeviceControlRuntimeStopResult(
      status = DeviceControlRuntimeStopStatus.STOPPED,
    )
  }

  fun runtimeState(): DeviceControlRuntimeState {
    return synchronized(stateLock) {
      val softLockState = runtime?.runtimeState() ?: SoftLockRuntimeState.detached()
      DeviceControlRuntimeState(
        serviceRunning = serviceRunning,
        softLock = if (
          lifecycleFailure != null && softLockState.diagnostics.lastFailure == null
        ) {
          softLockState.copy(
            diagnostics = softLockState.diagnostics.copy(lastFailure = lifecycleFailure),
          )
        } else {
          softLockState
        },
      )
    }
  }

  private fun ensureAttachedLocked(): SoftLockRuntimeHandle {
    val current = runtime ?: runtimeFactory().also { runtime = it }
    current.attach()
    return current
  }

  private fun failStart(
    serviceGeneration: Long?,
    code: SoftLockFailureCode,
    reason: String,
  ) {
    synchronized(stateLock) {
      if (
        serviceGeneration != null
        && serviceGeneration != activeServiceGeneration
      ) {
        return
      }
      activeServiceGeneration = null
      serviceRunning = false
      serviceStartRequested = false
      lifecycleFailure = SoftLockFailure(code = code, message = reason)
      runtime?.detach()
    }
  }

  private fun stopFailed(
    claim: DeviceControlServiceStopClaim,
    reason: String,
  ): DeviceControlRuntimeStopResult {
    synchronized(stateLock) {
      if (stoppingServiceGeneration == claim.serviceGeneration) {
        stoppingServiceGeneration = null
        if (activeServiceGeneration == null) {
          activeServiceGeneration = claim.serviceGeneration
          serviceRunning = claim.wasRunning
          serviceStartRequested = claim.wasStartRequested
        }
      }
      lifecycleFailure = SoftLockFailure(
        code = SoftLockFailureCode.SERVICE_STOP_FAILED,
        message = reason,
      )
    }
    return DeviceControlRuntimeStopResult(
      status = DeviceControlRuntimeStopStatus.FAILED,
      reason = reason,
    )
  }
}
