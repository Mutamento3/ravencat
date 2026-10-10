package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockOverlayStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoftLockWindowOwnerTest {
  private val host = FakeSoftLockWindowHost()
  private var permissionGranted = true
  private val owner = SoftLockWindowOwner(host) { permissionGranted }

  @Test
  fun `desired lock with permission adds once`() {
    owner.reconcile("lock-1")

    assertEquals(listOf("add:lock-1"), host.operations)
    assertTrue(owner.snapshot().attached)
    assertEquals("lock-1", owner.snapshot().attachedLockId)
    assertEquals(SoftLockOverlayStatus.ATTACHED, owner.snapshot().overlayStatus)
  }

  @Test
  fun `ten repeated target decisions do not duplicate add`() {
    repeat(10) { owner.reconcile("lock-1") }

    assertEquals(1, host.addCount)
  }

  @Test
  fun `repeated detached decisions remove at most once`() {
    owner.reconcile("lock-1")

    repeat(10) { owner.reconcile(null) }

    assertEquals(1, host.removeCount)
    assertFalse(owner.snapshot().attached)
    assertNull(owner.snapshot().attachedLockId)
  }

  @Test
  fun `leave and reenter adds a second time`() {
    owner.reconcile("lock-1")
    owner.reconcile(null)
    owner.reconcile("lock-1")

    assertEquals(2, host.addCount)
    assertEquals(1, host.removeCount)
    assertTrue(owner.snapshot().attached)
  }

  @Test
  fun `permission missing never adds and records typed diagnostic`() {
    permissionGranted = false

    owner.reconcile("lock-1")

    assertEquals(0, host.addCount)
    assertFalse(owner.snapshot().attached)
    assertEquals(SoftLockOverlayStatus.PERMISSION_MISSING, owner.snapshot().overlayStatus)
    assertEquals(
      SoftLockFailureCode.OVERLAY_PERMISSION_MISSING,
      owner.snapshot().lastFailure?.code,
    )
  }

  @Test
  fun `permission revoked detaches on next reconcile`() {
    owner.reconcile("lock-1")
    permissionGranted = false

    owner.reconcile("lock-1")

    assertEquals(1, host.removeCount)
    assertFalse(owner.snapshot().attached)
    assertEquals(SoftLockOverlayStatus.PERMISSION_MISSING, owner.snapshot().overlayStatus)
  }

  @Test
  fun `add failure remains detached with typed diagnostic`() {
    host.addFailure = IllegalStateException("add boom")

    owner.reconcile("lock-1")

    assertFalse(owner.snapshot().attached)
    assertNull(owner.snapshot().attachedLockId)
    assertEquals(SoftLockOverlayStatus.ADD_FAILED, owner.snapshot().overlayStatus)
    assertEquals(SoftLockFailureCode.WINDOW_ADD_FAILED, owner.snapshot().lastFailure?.code)
  }

  @Test
  fun `remove failure still clears local attached fact`() {
    owner.reconcile("lock-1")
    host.removeFailure = IllegalArgumentException("already removed")

    owner.reconcile(null)
    owner.reconcile(null)

    assertEquals(1, host.removeCount)
    assertFalse(owner.snapshot().attached)
    assertNull(owner.snapshot().attachedLockId)
    assertEquals(SoftLockOverlayStatus.REMOVE_FAILED, owner.snapshot().overlayStatus)
    assertEquals(SoftLockFailureCode.WINDOW_REMOVE_FAILED, owner.snapshot().lastFailure?.code)
  }

  @Test
  fun `switch owner removes old before adding new`() {
    owner.reconcile("lock-a")

    owner.reconcile("lock-b")

    assertEquals(listOf("add:lock-a", "remove", "add:lock-b"), host.operations)
    assertEquals("lock-b", owner.snapshot().attachedLockId)
  }

  @Test
  fun `switch owner stops after remove failure`() {
    owner.reconcile("lock-a")
    host.removeFailure = IllegalStateException("remove boom")

    owner.reconcile("lock-b")

    assertEquals(listOf("add:lock-a", "remove"), host.operations)
    assertFalse(owner.snapshot().attached)
    assertEquals(SoftLockOverlayStatus.REMOVE_FAILED, owner.snapshot().overlayStatus)
  }

  @Test
  fun `exit launch failure is retained while window stays attached`() {
    owner.reconcile("lock-1")

    host.publishFailure(
      SoftLockFailure(SoftLockFailureCode.LAUNCH_FAILED, "launch boom"),
    )

    assertTrue(owner.snapshot().attached)
    assertEquals(SoftLockOverlayStatus.ATTACHED, owner.snapshot().overlayStatus)
    assertEquals(SoftLockFailureCode.LAUNCH_FAILED, owner.snapshot().lastFailure?.code)
  }
}

private class FakeSoftLockWindowHost : SoftLockWindowHost {
  val operations = mutableListOf<String>()
  var addFailure: RuntimeException? = null
  var removeFailure: RuntimeException? = null
  private var failureListener: ((SoftLockFailure) -> Unit)? = null

  val addCount: Int
    get() = operations.count { it.startsWith("add:") }

  val removeCount: Int
    get() = operations.count { it == "remove" }

  override fun add(lockId: String, onFailure: (SoftLockFailure) -> Unit) {
    operations.add("add:$lockId")
    addFailure?.let { throw it }
    failureListener = onFailure
  }

  override fun remove() {
    operations.add("remove")
    removeFailure?.let { throw it }
    failureListener = null
  }

  fun publishFailure(failure: SoftLockFailure) {
    checkNotNull(failureListener)(failure)
  }
}
