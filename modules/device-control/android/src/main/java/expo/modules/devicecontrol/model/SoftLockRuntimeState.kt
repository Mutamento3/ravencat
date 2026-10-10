package expo.modules.devicecontrol.model

import expo.modules.deviceobserver.DeviceWindowState

/** blocking overlay 的实际 native window 状态。 */
enum class SoftLockOverlayStatus(val serial: String) {
  DETACHED("detached"),
  ATTACHED("attached"),
  PERMISSION_MISSING("permission_missing"),
  ADD_FAILED("add_failed"),
  REMOVE_FAILED("remove_failed"),
}

/** Soft Lock 执行边界的 typed failure；message 只补充原生异常上下文。 */
enum class SoftLockFailureCode(val serial: String) {
  RUNTIME_UNAVAILABLE("runtime_unavailable"),
  BACKGROUND_START_RESTRICTED("background_start_restricted"),
  SERVICE_START_FAILED("service_start_failed"),
  SERVICE_STOP_FAILED("service_stop_failed"),
  OVERLAY_PERMISSION_MISSING("overlay_permission_missing"),
  WINDOW_ADD_FAILED("window_add_failed"),
  WINDOW_REMOVE_FAILED("window_remove_failed"),
  LAUNCH_FAILED("launch_failed"),
}

data class SoftLockFailure(
  val code: SoftLockFailureCode,
  val message: String,
) {
  fun toMap(): Map<String, String> {
    return mapOf(
      "code" to code.serial,
      "message" to message,
    )
  }
}

/** runtime 级诊断事实；只反映运行时观察，不持久化、不携带业务历史。 */
data class SoftLockRuntimeDiagnostics(
  val attachedAtEpochMs: Long? = null,
  val lastReconcileAtEpochMs: Long? = null,
  val lastWindowEventAtEpochMs: Long? = null,
  val lastConnectionEventAtEpochMs: Long? = null,
  val lastFailure: SoftLockFailure? = null,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "attachedAtEpochMs" to attachedAtEpochMs,
      "lastReconcileAtEpochMs" to lastReconcileAtEpochMs,
      "lastWindowEventAtEpochMs" to lastWindowEventAtEpochMs,
      "lastConnectionEventAtEpochMs" to lastConnectionEventAtEpochMs,
      "lastFailure" to lastFailure?.toMap(),
    )
  }
}

/**
 * Soft Lock native runtime 的运行时投影状态快照。
 *
 * - projectedLocks 只是 application 业务真值的瞬时投影，不是第二真值；
 * - observerConnected / currentWindow 是 Device Observer 事实；
 * - shouldBlock 是 controller 决策（observer 连接 + 窗口可靠 + package 匹配）；
 * - attached / attachedLockId / overlayStatus 只反映实际 native window，不是业务真值。
 */
data class SoftLockRuntimeState(
  val runtimeAttached: Boolean,
  val observerConnected: Boolean,
  val currentWindow: DeviceWindowState?,
  val projectedLocks: List<SoftLockProjection>,
  val matchingLockId: String?,
  val targetMatched: Boolean,
  val shouldBlock: Boolean,
  val attached: Boolean,
  val attachedLockId: String?,
  val overlayStatus: SoftLockOverlayStatus,
  val diagnostics: SoftLockRuntimeDiagnostics,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "runtimeAttached" to runtimeAttached,
      "observerConnected" to observerConnected,
      "currentWindow" to currentWindow?.toMap(),
      "projectedLocks" to projectedLocks.map(SoftLockProjection::toMap),
      "matchingLockId" to matchingLockId,
      "targetMatched" to targetMatched,
      "shouldBlock" to shouldBlock,
      "attached" to attached,
      "attachedLockId" to attachedLockId,
      "overlayStatus" to overlayStatus.serial,
      "diagnostics" to diagnostics.toMap(),
    )
  }

  companion object {
    fun detached(): SoftLockRuntimeState {
      return SoftLockRuntimeState(
        runtimeAttached = false,
        observerConnected = false,
        currentWindow = null,
        projectedLocks = emptyList(),
        matchingLockId = null,
        targetMatched = false,
        shouldBlock = false,
        attached = false,
        attachedLockId = null,
        overlayStatus = SoftLockOverlayStatus.DETACHED,
        diagnostics = SoftLockRuntimeDiagnostics(),
      )
    }
  }
}
