package expo.modules.devicecontrol.controller

import org.junit.Assert.assertEquals
import org.junit.Test

class NotificationListenerAccessReaderTest {
  @Test
  fun `每次读取当前系统授权真值`() {
    var granted = false
    val reader = NotificationListenerAccessReader { granted }

    assertEquals("not_granted", reader.getState()["status"])
    granted = true
    assertEquals("granted", reader.getState()["status"])
  }
}
