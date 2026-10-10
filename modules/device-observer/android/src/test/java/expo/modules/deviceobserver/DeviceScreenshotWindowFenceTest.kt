package expo.modules.deviceobserver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceScreenshotWindowFenceTest {
  @Test
  fun `same window accepts captured result`() {
    val captured = Any()
    var discarded = false

    val accepted = DeviceScreenshotWindowFence.acceptCaptured(
      expected = identity("com.example.article", 17),
      started = snapshot("com.example.article", 17, revision = 4L),
      completed = snapshot("com.example.article", 17, revision = 4L),
      captured = captured,
      discard = { discarded = true },
    )

    assertEquals(captured, accepted)
    assertFalse(discarded)
  }

  @Test
  fun `changed window discards captured result`() {
    var discarded = false

    val error = assertThrows(DeviceScreenshotException::class.java) {
      DeviceScreenshotWindowFence.acceptCaptured(
        expected = identity("com.example.article", 17),
        started = snapshot("com.example.article", 17, revision = 4L),
        completed = snapshot("com.example.chat", 23, revision = 4L),
        captured = Any(),
        discard = { discarded = true },
      )
    }

    assertEquals("window_changed", error.reason)
    assertTrue(discarded)
  }

  @Test
  fun `same final identity with changed revision rejects ABA`() {
    var discarded = false

    val error = assertThrows(DeviceScreenshotException::class.java) {
      DeviceScreenshotWindowFence.acceptCaptured(
        expected = identity("com.example.article", 17),
        started = snapshot("com.example.article", 17, revision = 4L),
        completed = snapshot("com.example.article", 17, revision = 6L),
        captured = Any(),
        discard = { discarded = true },
      )
    }

    assertEquals("window_changed", error.reason)
    assertTrue(discarded)
  }

  @Test
  fun `window unavailable rejects capture start`() {
    val error = assertThrows(DeviceScreenshotException::class.java) {
      DeviceScreenshotWindowFence.assertCaptureStart(
        expected = identity("com.example.article", 17),
        started = DeviceWindowRevisionSnapshot(windowState = null, revision = 4L),
      )
    }

    assertEquals("window_unavailable", error.reason)
  }

  @Test
  fun `reject path executes discard`() {
    var discardCount = 0

    assertThrows(DeviceScreenshotException::class.java) {
      DeviceScreenshotWindowFence.acceptCaptured(
        expected = identity("com.example.article", 17),
        started = snapshot("com.example.article", 17, revision = 4L),
        completed = snapshot("com.example.article", 17, revision = 5L),
        captured = Any(),
        discard = { discardCount += 1 },
      )
    }

    assertEquals(1, discardCount)
  }

  private fun identity(packageName: String, windowId: Int) = DeviceWindowIdentity(
    packageName = packageName,
    windowId = windowId,
  )

  private fun snapshot(
    packageName: String,
    windowId: Int,
    revision: Long,
  ) = DeviceWindowRevisionSnapshot(
    windowState = DeviceWindowState(
      packageName = packageName,
      windowId = windowId,
      title = null,
      detectionReliable = true,
      checkedAtEpochMs = 1L,
      source = "accessibility",
    ),
    revision = revision,
  )
}
