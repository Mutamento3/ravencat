package expo.modules.deviceobserver

/** 截图必须始终属于调用方已完成隐私校验的同一个窗口。 */
internal object DeviceScreenshotWindowFence {
  fun assertCaptureStart(
    expected: DeviceWindowIdentity,
    started: DeviceWindowRevisionSnapshot,
  ) {
    assertCurrentWindow(expected, started.windowState)
  }

  fun <T> acceptCaptured(
    expected: DeviceWindowIdentity,
    started: DeviceWindowRevisionSnapshot,
    completed: DeviceWindowRevisionSnapshot,
    captured: T,
    discard: (T) -> Unit,
  ): T {
    try {
      assertCurrentWindow(expected, completed.windowState)
      if (started.revision != completed.revision) {
        throw DeviceScreenshotException(
          "window_changed",
          "截图期间当前窗口发生变化，截图已作废",
        )
      }
      return captured
    } catch (error: DeviceScreenshotException) {
      discard(captured)
      throw error
    }
  }

  private fun assertCurrentWindow(
    expected: DeviceWindowIdentity,
    actual: DeviceWindowState?,
  ) {
    when (compareExpectedCurrentWindow(expected, actual)) {
      DeviceCurrentWindowMismatch.WINDOW_UNAVAILABLE -> throw DeviceScreenshotException(
        "window_unavailable",
        "设备观察无法确认当前窗口，截图已取消",
      )
      DeviceCurrentWindowMismatch.WINDOW_CHANGED -> throw DeviceScreenshotException(
        "window_changed",
        "截图期间当前窗口发生变化，截图已作废",
      )
      null -> Unit
    }
  }
}
