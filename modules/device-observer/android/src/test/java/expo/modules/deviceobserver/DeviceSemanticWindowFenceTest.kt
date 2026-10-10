package expo.modules.deviceobserver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class DeviceSemanticWindowFenceTest {
  @Test
  fun `same window accepts semantic snapshot freeze`() {
    DeviceSemanticWindowFence.assertReadStart(
      identity("com.example.article", 17),
      window("com.example.article", 17),
    )
  }

  @Test
  fun `changed window before freeze rejects semantic read`() {
    val error = assertThrows(DeviceSemanticReadException::class.java) {
      DeviceSemanticWindowFence.assertReadStart(
        identity("com.example.article", 17),
        window("com.example.bank", 23),
      )
    }

    assertEquals("window_changed", error.reason)
  }

  @Test
  fun `missing window before freeze rejects semantic read`() {
    val error = assertThrows(DeviceSemanticReadException::class.java) {
      DeviceSemanticWindowFence.assertReadStart(identity("com.example.article", 17), null)
    }

    assertEquals("window_unavailable", error.reason)
  }

  private fun identity(packageName: String, windowId: Int) = DeviceWindowIdentity(
    packageName = packageName,
    windowId = windowId,
  )

  private fun window(
    packageName: String,
    windowId: Int,
  ) = DeviceWindowState(
    packageName = packageName,
    windowId = windowId,
    title = null,
    detectionReliable = true,
    checkedAtEpochMs = 1L,
    source = "accessibility",
  )
}
