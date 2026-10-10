package expo.modules.deviceobserver

import org.junit.Assert.assertEquals
import org.junit.Test

class DeviceWindowObservationTrackerTest {
  private val published = mutableListOf<DeviceWindowState>()
  private val tracker = DeviceWindowObservationTracker(published::add)

  @Test
  fun `repeated identical raw events increment revision but publish once`() {
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 1L) }
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 2L) }

    assertEquals(2L, tracker.revision)
    assertEquals(listOf(TARGET_PACKAGE), published.map(DeviceWindowState::packageName))
  }

  @Test
  fun `overlay event with same normalized target does not publish target again`() {
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 1L) }
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 2L) }

    assertEquals(2L, tracker.revision)
    assertEquals(1, published.size)
  }

  @Test
  fun `switching to another application publishes new foreground once`() {
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 1L) }
    tracker.observeRawWindowEvent { reliableState(ANOTHER_PACKAGE, checkedAtEpochMs = 2L) }
    tracker.observeRawWindowEvent { reliableState(ANOTHER_PACKAGE, checkedAtEpochMs = 3L) }

    assertEquals(3L, tracker.revision)
    assertEquals(
      listOf(TARGET_PACKAGE, ANOTHER_PACKAGE),
      published.map(DeviceWindowState::packageName),
    )
  }

  @Test
  fun `transition from target to unreliable publishes unreliable fact`() {
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 1L) }
    tracker.observeRawWindowEvent { unreliableState(checkedAtEpochMs = 2L) }

    assertEquals(2L, tracker.revision)
    assertEquals(listOf(true, false), published.map(DeviceWindowState::detectionReliable))
  }

  @Test
  fun `transition from unreliable to target publishes restored fact`() {
    tracker.observeRawWindowEvent { unreliableState(checkedAtEpochMs = 1L) }
    tracker.observeRawWindowEvent { reliableState(TARGET_PACKAGE, checkedAtEpochMs = 2L) }

    assertEquals(2L, tracker.revision)
    assertEquals(listOf(false, true), published.map(DeviceWindowState::detectionReliable))
  }

  @Test
  fun `dedupe ignores timestamp but compares every foreground semantic field`() {
    val initial = reliableState(TARGET_PACKAGE, checkedAtEpochMs = 1L)
    val semanticChanges = listOf(
      initial.copy(packageName = ANOTHER_PACKAGE),
      initial.copy(windowId = 18),
      initial.copy(title = "新标题"),
      initial.copy(detectionReliable = false),
      initial.copy(source = "another_source"),
    )

    val timestampOnlyPublished = mutableListOf<DeviceWindowState>()
    val timestampTracker = DeviceWindowObservationTracker(timestampOnlyPublished::add)
    timestampTracker.publishIfChanged(initial)
    timestampTracker.publishIfChanged(initial.copy(checkedAtEpochMs = 2L))
    assertEquals(1, timestampOnlyPublished.size)

    semanticChanges.forEach { changed ->
      val semanticPublished = mutableListOf<DeviceWindowState>()
      val semanticTracker = DeviceWindowObservationTracker(semanticPublished::add)
      semanticTracker.publishIfChanged(initial)
      semanticTracker.publishIfChanged(changed)
      assertEquals(2, semanticPublished.size)
    }
  }

  private fun reliableState(
    packageName: String,
    checkedAtEpochMs: Long,
  ): DeviceWindowState {
    return DeviceWindowState(
      packageName = packageName,
      windowId = if (packageName == TARGET_PACKAGE) 17 else 63,
      title = if (packageName == TARGET_PACKAGE) "小红书" else "微信",
      detectionReliable = true,
      checkedAtEpochMs = checkedAtEpochMs,
      source = "accessibility",
    )
  }

  private fun unreliableState(checkedAtEpochMs: Long): DeviceWindowState {
    return DeviceWindowState(
      packageName = null,
      windowId = null,
      title = null,
      detectionReliable = false,
      checkedAtEpochMs = checkedAtEpochMs,
      source = "accessibility",
    )
  }

  private companion object {
    const val TARGET_PACKAGE = "com.xingin.xhs"
    const val ANOTHER_PACKAGE = "com.tencent.mm"
  }
}
