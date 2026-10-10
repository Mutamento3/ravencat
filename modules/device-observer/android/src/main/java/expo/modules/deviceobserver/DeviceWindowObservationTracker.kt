package expo.modules.deviceobserver

/**
 * 记录原始窗口事件 revision，并只广播发生语义变化的 foreground fact。
 *
 * 最后一次广播只用于事件去重；当前窗口快照仍由 AccessibilityService 现场解析。
 */
internal class DeviceWindowObservationTracker(
  private val publish: (DeviceWindowState) -> Unit,
) {
  var revision: Long = 0L
    private set

  private var lastPublishedState: DeviceWindowState? = null

  fun observeRawWindowEvent(resolveState: () -> DeviceWindowState) {
    revision += 1
    publishIfChanged(resolveState())
  }

  fun publishIfChanged(state: DeviceWindowState) {
    if (lastPublishedState?.hasSameForegroundFact(state) == true) {
      return
    }
    publish(state)
    lastPublishedState = state
  }

  private fun DeviceWindowState.hasSameForegroundFact(other: DeviceWindowState): Boolean {
    return packageName == other.packageName &&
      windowId == other.windowId &&
      title == other.title &&
      detectionReliable == other.detectionReliable &&
      source == other.source
  }
}
