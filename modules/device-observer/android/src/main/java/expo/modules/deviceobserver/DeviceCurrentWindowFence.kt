package expo.modules.deviceobserver

internal data class DeviceWindowIdentity(
  val packageName: String?,
  val windowId: Int,
)

internal data class DeviceWindowRevisionSnapshot(
  val windowState: DeviceWindowState?,
  val revision: Long,
)

internal enum class DeviceCurrentWindowMismatch {
  WINDOW_UNAVAILABLE,
  WINDOW_CHANGED,
}

/** 截图与语义快照冻结共用同一份 native 当前窗口身份比较。 */
internal fun compareExpectedCurrentWindow(
  expected: DeviceWindowIdentity,
  actual: DeviceWindowState?,
): DeviceCurrentWindowMismatch? {
  val actualWindowId = actual?.windowId
    ?: return DeviceCurrentWindowMismatch.WINDOW_UNAVAILABLE
  val actualIdentity = DeviceWindowIdentity(
    packageName = actual.packageName?.trim()?.lowercase(),
    windowId = actualWindowId,
  )
  val normalizedExpected = expected.copy(
    packageName = expected.packageName?.trim()?.lowercase(),
  )
  return if (actualIdentity == normalizedExpected) {
    null
  } else {
    DeviceCurrentWindowMismatch.WINDOW_CHANGED
  }
}
