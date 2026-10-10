package expo.modules.deviceobserver

/** 在获取语义根节点前，确认 native 当前窗口仍是调用方已完成隐私校验的目标。 */
internal object DeviceSemanticWindowFence {
  fun assertReadStart(
    expected: DeviceWindowIdentity,
    current: DeviceWindowState?,
  ) {
    when (compareExpectedCurrentWindow(expected, current)) {
      DeviceCurrentWindowMismatch.WINDOW_UNAVAILABLE -> throw DeviceSemanticReadException(
        "window_unavailable",
        "设备观察无法确认当前窗口，语义读取已取消",
      )
      DeviceCurrentWindowMismatch.WINDOW_CHANGED -> throw DeviceSemanticReadException(
        "window_changed",
        "语义快照冻结前当前窗口已经变化",
      )
      null -> Unit
    }
  }
}
