package expo.modules.devicecontrol.model

enum class DeviceControlRuntimeStartStatus(val serial: String) {
  STARTED("started"),
  ALREADY_RUNNING("already_running"),
  BACKGROUND_START_RESTRICTED("background_start_restricted"),
  FAILED("failed"),
}

data class DeviceControlRuntimeStartResult(
  val status: DeviceControlRuntimeStartStatus,
  val reason: String? = null,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "status" to status.serial,
      "reason" to reason,
    )
  }
}

enum class DeviceControlRuntimeStopStatus(val serial: String) {
  STOPPED("stopped"),
  ALREADY_STOPPED("already_stopped"),
  STILL_ACTIVE("still_active"),
  FAILED("failed"),
}

data class DeviceControlRuntimeStopResult(
  val status: DeviceControlRuntimeStopStatus,
  val activeProjectionCount: Int = 0,
  val reason: String? = null,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "status" to status.serial,
      "activeProjectionCount" to activeProjectionCount,
      "reason" to reason,
    )
  }
}

data class DeviceControlRuntimeState(
  val serviceRunning: Boolean,
  val softLock: SoftLockRuntimeState,
) {
  fun toMap(): Map<String, Any?> {
    return softLock.toMap() + ("serviceRunning" to serviceRunning)
  }
}
