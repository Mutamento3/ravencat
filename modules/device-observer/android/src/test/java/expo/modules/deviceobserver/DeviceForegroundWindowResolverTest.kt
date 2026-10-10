package expo.modules.deviceobserver

import android.view.accessibility.AccessibilityWindowInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceForegroundWindowResolverTest {
  @Test
  fun `active target application resolves as foreground`() {
    val state = resolve(
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        active = true,
      ),
    )

    assertForeground(state, TARGET_PACKAGE, windowId = 17, title = "小红书")
  }

  @Test
  fun `self application overlay does not replace focused target application`() {
    val state = resolve(
      systemWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 41,
        title = "RavenCat Soft Lock",
        active = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        active = true,
        focused = true,
      ),
    )

    assertForeground(state, TARGET_PACKAGE, windowId = 17, title = "小红书")
  }

  @Test
  fun `repeated self overlay events keep normalized foreground stable`() {
    val facts = listOf(
      systemWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 41,
        title = "RavenCat Soft Lock",
        active = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        focused = true,
      ),
    )

    val packages = List(5) { resolve(*facts.toTypedArray()).packageName }

    assertEquals(List(5) { TARGET_PACKAGE }, packages)
  }

  @Test
  fun `removing overlay keeps target application as foreground`() {
    val state = resolve(
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        active = true,
        focused = true,
      ),
    )

    assertForeground(state, TARGET_PACKAGE, windowId = 17, title = "小红书")
  }

  @Test
  fun `real RavenCat activity resolves as foreground`() {
    val state = resolve(
      applicationWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 52,
        title = "RavenCat",
        focused = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        active = true,
      ),
    )

    assertForeground(state, RAVEN_CAT_PACKAGE, windowId = 52, title = "RavenCat")
  }

  @Test
  fun `switching from target to another application resolves new foreground`() {
    val state = resolve(
      applicationWindow(
        packageName = ANOTHER_PACKAGE,
        windowId = 63,
        title = "微信",
        focused = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
      ),
    )

    assertForeground(state, ANOTHER_PACKAGE, windowId = 63, title = "微信")
  }

  @Test
  fun `focused launcher resolves as foreground application`() {
    val state = resolve(
      applicationWindow(
        packageName = LAUNCHER_PACKAGE,
        windowId = 74,
        title = "Launcher",
        focused = true,
      ),
    )

    assertForeground(state, LAUNCHER_PACKAGE, windowId = 74, title = "Launcher")
  }

  @Test
  fun `without reliable application window detection is unreliable`() {
    val state = resolve(
      systemWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 41,
        title = "RavenCat Soft Lock",
        active = true,
      ),
    )

    assertFalse(state.detectionReliable)
    assertNull(state.packageName)
    assertNull(state.windowId)
    assertNull(state.title)
  }

  @Test
  fun `event and snapshot resolution of same window facts is identical`() {
    val facts = arrayOf(
      systemWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 41,
        title = "RavenCat Soft Lock",
        active = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        focused = true,
      ),
    )

    val eventState = resolve(*facts)
    val snapshotState = resolve(*facts)

    assertEquals(eventState, snapshotState)
  }

  @Test
  fun `package window id and title all come from selected application window`() {
    val state = resolve(
      systemWindow(
        packageName = RAVEN_CAT_PACKAGE,
        windowId = 41,
        title = "RavenCat Soft Lock",
        active = true,
      ),
      applicationWindow(
        packageName = TARGET_PACKAGE,
        windowId = 17,
        title = "小红书",
        focused = true,
      ),
    )

    assertForeground(state, TARGET_PACKAGE, windowId = 17, title = "小红书")
  }

  @Test
  fun `package is read only from selected foreground candidate`() {
    val readPackages = mutableListOf<String>()
    val overlay = systemWindow(
      packageName = RAVEN_CAT_PACKAGE,
      windowId = 41,
      title = "RavenCat Soft Lock",
      active = true,
    )
    val target = applicationWindow(
      packageName = TARGET_PACKAGE,
      windowId = 17,
      title = "小红书",
      focused = true,
    )
    val background = applicationWindow(
      packageName = ANOTHER_PACKAGE,
      windowId = 63,
      title = "微信",
      active = true,
    )

    val state = DeviceForegroundWindowResolver.resolve(
      windows = listOf(overlay, target, background),
      checkedAtEpochMs = CHECKED_AT_EPOCH_MS,
      readWindowFact = FakeWindow::fact,
      readPackageName = { window ->
        readPackages.add(window.packageName)
        window.packageName
      },
      readTitle = FakeWindow::title,
    )

    assertForeground(state, TARGET_PACKAGE, windowId = 17, title = "小红书")
    assertEquals(listOf(TARGET_PACKAGE), readPackages)
  }

  private fun resolve(
    vararg windows: FakeWindow,
  ): DeviceWindowState {
    return DeviceForegroundWindowResolver.resolve(
      windows = windows.toList(),
      checkedAtEpochMs = CHECKED_AT_EPOCH_MS,
      readWindowFact = FakeWindow::fact,
      readPackageName = FakeWindow::packageName,
      readTitle = FakeWindow::title,
    )
  }

  private fun applicationWindow(
    packageName: String,
    windowId: Int,
    title: String,
    active: Boolean = false,
    focused: Boolean = false,
  ): FakeWindow {
    return windowFact(
      packageName = packageName,
      windowId = windowId,
      title = title,
      type = AccessibilityWindowInfo.TYPE_APPLICATION,
      active = active,
      focused = focused,
    )
  }

  private fun systemWindow(
    packageName: String,
    windowId: Int,
    title: String,
    active: Boolean = false,
  ): FakeWindow {
    return windowFact(
      packageName = packageName,
      windowId = windowId,
      title = title,
      type = AccessibilityWindowInfo.TYPE_SYSTEM,
      active = active,
      focused = false,
    )
  }

  private fun windowFact(
    packageName: String,
    windowId: Int,
    title: String,
    type: Int,
    active: Boolean,
    focused: Boolean,
  ): FakeWindow {
    return FakeWindow(
      packageName = packageName,
      title = title,
      fact = DeviceAccessibilityWindowFact(
        windowId = windowId,
        type = type,
        active = active,
        focused = focused,
      ),
    )
  }

  private fun assertForeground(
    state: DeviceWindowState,
    packageName: String,
    windowId: Int,
    title: String,
  ) {
    assertTrue(state.detectionReliable)
    assertEquals(packageName, state.packageName)
    assertEquals(windowId, state.windowId)
    assertEquals(title, state.title)
  }

  private companion object {
    const val CHECKED_AT_EPOCH_MS = 123L
    const val TARGET_PACKAGE = "com.xingin.xhs"
    const val RAVEN_CAT_PACKAGE = "com.example.kimiphone"
    const val ANOTHER_PACKAGE = "com.tencent.mm"
    const val LAUNCHER_PACKAGE = "com.android.launcher3"
  }

  private data class FakeWindow(
    val packageName: String,
    val title: String,
    val fact: DeviceAccessibilityWindowFact,
  )
}
