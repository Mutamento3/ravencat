package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.SoftLockProjection
import expo.modules.deviceobserver.DeviceWindowState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoftLockControllerTest {
  private val controller = SoftLockController()
  private val nowEpochMs = 1000L

  @Test
  fun `matching reliable connected target gives shouldBlock`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = window("com.example.target", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertEquals("lock-1", decision.matchingLockId)
    assertTrue(decision.targetMatched)
    assertTrue(decision.shouldBlock)
  }

  @Test
  fun `non target package does not block`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = window("com.example.other", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertNull(decision.matchingLockId)
    assertFalse(decision.targetMatched)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `unreliable window does not become shouldBlock`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = window("com.example.target", reliable = false),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertTrue(decision.targetMatched)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `disconnected observer does not block`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = window("com.example.target", reliable = true),
      observerConnected = false,
      nowEpochMs = nowEpochMs,
    )

    assertTrue(decision.targetMatched)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `null window does not block`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = null,
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertNull(decision.matchingLockId)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `unknown package window does not block`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target")),
      currentWindow = window(null, reliable = false),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertNull(decision.matchingLockId)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `expired projection does not match`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target", expiresAtEpochMs = 500L)),
      currentWindow = window("com.example.target", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertNull(decision.matchingLockId)
    assertFalse(decision.targetMatched)
    assertFalse(decision.shouldBlock)
  }

  @Test
  fun `not yet expired projection still matches`() {
    val decision = controller.reconcile(
      activeLocks = listOf(lock("lock-1", "com.example.target", expiresAtEpochMs = 1500L)),
      currentWindow = window("com.example.target", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertEquals("lock-1", decision.matchingLockId)
    assertTrue(decision.shouldBlock)
  }

  @Test
  fun `multiple locks resolve the matching one`() {
    val decision = controller.reconcile(
      activeLocks = listOf(
        lock("lock-1", "com.example.first"),
        lock("lock-2", "com.example.second"),
      ),
      currentWindow = window("com.example.second", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertEquals("lock-2", decision.matchingLockId)
    assertTrue(decision.shouldBlock)
  }

  @Test
  fun `no active locks never blocks`() {
    val decision = controller.reconcile(
      activeLocks = emptyList(),
      currentWindow = window("com.example.target", reliable = true),
      observerConnected = true,
      nowEpochMs = nowEpochMs,
    )

    assertNull(decision.matchingLockId)
    assertFalse(decision.shouldBlock)
  }

  private fun lock(
    id: String,
    targetPackage: String,
    expiresAtEpochMs: Long? = null,
  ): SoftLockProjection {
    return SoftLockProjection(
      id = id,
      targetPackage = targetPackage,
      expiresAtEpochMs = expiresAtEpochMs,
    )
  }

  private fun window(packageName: String?, reliable: Boolean): DeviceWindowState {
    return DeviceWindowState(
      packageName = packageName,
      windowId = 7,
      title = null,
      detectionReliable = reliable,
      checkedAtEpochMs = 100L,
      source = if (reliable) "accessibility" else "unknown",
    )
  }
}
