package expo.modules.deviceobserver

import android.view.accessibility.AccessibilityWindowInfo

/** Device Observer 从 Android 当前交互窗口读取的单窗口事实。 */
internal data class DeviceAccessibilityWindowFact(
  val windowId: Int,
  val type: Int,
  val active: Boolean,
  val focused: Boolean,
)

/**
 * 把 Android 交互窗口正规化为用户真正所在的前台应用窗口。
 *
 * `TYPE_APPLICATION_OVERLAY` 在 Accessibility 中属于 system window；它即使发出窗口事件，
 * 也不能替代下方仍持有输入焦点的 Activity。Android 返回的窗口已按 Z-order 从高到低排序，
 * 所以同一优先级内直接选择第一个 application candidate；只有选中后才读取它的 root package。
 */
internal object DeviceForegroundWindowResolver {
  fun <T> resolve(
    windows: List<T>,
    checkedAtEpochMs: Long,
    readWindowFact: (T) -> DeviceAccessibilityWindowFact,
    readPackageName: (T) -> String?,
    readTitle: (T) -> String?,
  ): DeviceWindowState {
    var activeCandidate: DeviceForegroundWindowCandidate<T>? = null
    var foreground: DeviceForegroundWindowCandidate<T>? = null
    for (window in windows) {
      val fact = readWindowFact(window)
      if (!fact.isApplicationCandidate()) {
        continue
      }
      if (fact.focused) {
        foreground = DeviceForegroundWindowCandidate(window, fact)
        break
      }
      if (fact.active && activeCandidate == null) {
        activeCandidate = DeviceForegroundWindowCandidate(window, fact)
      }
    }
    foreground = foreground ?: activeCandidate

    if (foreground == null) {
      return unreliable(checkedAtEpochMs)
    }

    val packageName = readPackageName(foreground.window)
      ?.trim()
      ?.takeIf { it.isNotEmpty() }
      ?: return unreliable(checkedAtEpochMs)
    return DeviceWindowState(
      packageName = packageName,
      windowId = foreground.fact.windowId,
      title = readTitle(foreground.window)?.trim()?.takeIf { it.isNotEmpty() },
      detectionReliable = true,
      checkedAtEpochMs = checkedAtEpochMs,
      source = "accessibility",
    )
  }

  private fun DeviceAccessibilityWindowFact.isApplicationCandidate(): Boolean {
    return type == AccessibilityWindowInfo.TYPE_APPLICATION &&
      windowId >= 0
  }

  private fun unreliable(checkedAtEpochMs: Long): DeviceWindowState {
    return DeviceWindowState(
      packageName = null,
      windowId = null,
      title = null,
      detectionReliable = false,
      checkedAtEpochMs = checkedAtEpochMs,
      source = "accessibility",
    )
  }

  private data class DeviceForegroundWindowCandidate<T>(
    val window: T,
    val fact: DeviceAccessibilityWindowFact,
  )
}
