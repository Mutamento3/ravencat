package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockOverlayStatus

/**
 * blocking window 的最小 host seam。真实实现复用 OverlayWindowHost，
 * 单测使用 fake；幂等与 owner 切换不下沉到通用 overlay primitive。
 */
interface SoftLockWindowHost {
  fun add(
    lockId: String,
    onFailure: (SoftLockFailure) -> Unit,
  )

  fun remove()
}

/** 实际 WindowManager 投影快照；业务 active lock 不从这里反推。 */
data class SoftLockWindowState(
  val attached: Boolean = false,
  val attachedLockId: String? = null,
  val overlayStatus: SoftLockOverlayStatus = SoftLockOverlayStatus.DETACHED,
  val lastFailure: SoftLockFailure? = null,
)

/**
 * Soft Lock blocking window 的唯一 native owner。
 *
 * 所有方法都由 SoftLockRuntime 注入的主线程执行器调用。状态发布使用不可变 volatile
 * 快照，使 bridge 可以诚实读取实际 attached fact，而不需要持锁执行 WindowManager。
 */
class SoftLockWindowOwner(
  private val windowHost: SoftLockWindowHost,
  private val overlayPermissionGranted: () -> Boolean,
) {
  @Volatile
  private var state = SoftLockWindowState()

  fun reconcile(desiredLockId: String?) {
    if (desiredLockId == null) {
      detach(SoftLockOverlayStatus.DETACHED)
      return
    }

    if (!overlayPermissionGranted()) {
      detach(SoftLockOverlayStatus.PERMISSION_MISSING)
      if (state.overlayStatus != SoftLockOverlayStatus.REMOVE_FAILED) {
        state = state.copy(
          overlayStatus = SoftLockOverlayStatus.PERMISSION_MISSING,
          lastFailure = SoftLockFailure(
            code = SoftLockFailureCode.OVERLAY_PERMISSION_MISSING,
            message = "未获得系统悬浮窗权限",
          ),
        )
      }
      return
    }

    val current = state
    if (current.attached && current.attachedLockId == desiredLockId) {
      return
    }

    if (current.attached && !removeAttachedWindow()) {
      return
    }

    try {
      windowHost.add(desiredLockId, ::recordFailure)
      state = SoftLockWindowState(
        attached = true,
        attachedLockId = desiredLockId,
        overlayStatus = SoftLockOverlayStatus.ATTACHED,
      )
    } catch (error: RuntimeException) {
      state = SoftLockWindowState(
        overlayStatus = SoftLockOverlayStatus.ADD_FAILED,
        lastFailure = SoftLockFailure(
          code = SoftLockFailureCode.WINDOW_ADD_FAILED,
          message = error.message ?: "WindowManager.addView 失败",
        ),
      )
    }
  }

  fun snapshot(): SoftLockWindowState = state

  private fun detach(successStatus: SoftLockOverlayStatus) {
    if (!state.attached) {
      state = state.copy(
        attached = false,
        attachedLockId = null,
        overlayStatus = if (
          state.overlayStatus == SoftLockOverlayStatus.REMOVE_FAILED &&
          successStatus == SoftLockOverlayStatus.DETACHED
        ) {
          SoftLockOverlayStatus.REMOVE_FAILED
        } else {
          successStatus
        },
      )
      return
    }

    if (removeAttachedWindow()) {
      state = state.copy(overlayStatus = successStatus)
    }
  }

  /** remove 失败也必须先把本地 attached fact 归零，避免继续阻断或重复 remove。 */
  private fun removeAttachedWindow(): Boolean {
    return try {
      windowHost.remove()
      state = state.copy(
        attached = false,
        attachedLockId = null,
        overlayStatus = SoftLockOverlayStatus.DETACHED,
      )
      true
    } catch (error: RuntimeException) {
      state = SoftLockWindowState(
        overlayStatus = SoftLockOverlayStatus.REMOVE_FAILED,
        lastFailure = SoftLockFailure(
          code = SoftLockFailureCode.WINDOW_REMOVE_FAILED,
          message = error.message ?: "WindowManager.removeView 失败",
        ),
      )
      false
    }
  }

  private fun recordFailure(failure: SoftLockFailure) {
    state = state.copy(lastFailure = failure)
  }
}
