package expo.modules.androidoverlayruntime

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Test

class OverlayInteractionExclusionTest {
  private val owners = mutableListOf<Any>()
  private val unsubscribes = mutableListOf<() -> Unit>()
  private fun owner() = Any().also { owners.add(it) }

  @After
  fun cleanup() {
    unsubscribes.forEach { it() }
    owners.forEach { OverlayInteractionExclusion.release(it) }
  }

  @Test
  fun `call execution hides ordinary overlays and termination restores them once`() {
    val changes = mutableListOf<Boolean>()
    unsubscribes.add(OverlayInteractionExclusion.subscribe { changes.add(it) })
    val call = owner()
    OverlayInteractionExclusion.acquire(call)
    OverlayInteractionExclusion.acquire(call)
    OverlayInteractionExclusion.release(call)
    OverlayInteractionExclusion.release(call)
    assertEquals(listOf(false, true, false), changes)
  }

  @Test
  fun `late subscribers immediately observe an active call and can detach`() {
    val call = owner()
    OverlayInteractionExclusion.acquire(call)
    val changes = mutableListOf<Boolean>()
    val unsubscribe = OverlayInteractionExclusion.subscribe { changes.add(it) }
    assertEquals(listOf(true), changes)
    unsubscribe()
    OverlayInteractionExclusion.release(call)
    assertEquals(listOf(true), changes)
  }

  @Test
  fun `stale owner release cannot uncover another interaction`() {
    val changes = mutableListOf<Boolean>()
    unsubscribes.add(OverlayInteractionExclusion.subscribe { changes.add(it) })
    val old = owner()
    val current = owner()
    OverlayInteractionExclusion.acquire(old)
    OverlayInteractionExclusion.acquire(current)
    OverlayInteractionExclusion.release(old)
    OverlayInteractionExclusion.release(old)
    assertEquals(listOf(false, true), changes)
    OverlayInteractionExclusion.release(current)
    assertEquals(listOf(false, true, false), changes)
  }
}
