package expo.modules.deviceobserver

/** 仅保存 Android 当前窗口的技术事实，不承载业务黑名单或策略结果。 */
data class DeviceWindowState(
  val packageName: String?,
  val windowId: Int?,
  val title: String?,
  val detectionReliable: Boolean,
  val checkedAtEpochMs: Long,
  val source: String,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "packageName" to packageName,
      "windowId" to windowId,
      "title" to title,
      "detectionReliable" to detectionReliable,
      "checkedAtEpochMs" to checkedAtEpochMs,
      "source" to source,
    )
  }

  companion object {
    fun unknown(checkedAtEpochMs: Long = System.currentTimeMillis()): DeviceWindowState {
      return DeviceWindowState(
        packageName = null,
        windowId = null,
        title = null,
        detectionReliable = false,
        checkedAtEpochMs = checkedAtEpochMs,
        source = "unknown",
      )
    }
  }
}
