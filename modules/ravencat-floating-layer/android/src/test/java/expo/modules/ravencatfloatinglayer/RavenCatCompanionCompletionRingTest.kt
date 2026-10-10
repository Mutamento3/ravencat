package expo.modules.ravencatfloatinglayer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatCompanionCompletionRingTest {
  @Test
  fun `appended delivery id is contained`() {
    val ring = RavenCatCompanionCompletionRing.append(null, "delivery-a")

    assertTrue(RavenCatCompanionCompletionRing.contains(ring, "delivery-a"))
    assertFalse(RavenCatCompanionCompletionRing.contains(ring, "delivery-b"))
  }

  @Test
  fun `duplicate append keeps single entry`() {
    val ring = RavenCatCompanionCompletionRing.append(
      RavenCatCompanionCompletionRing.append(null, "delivery-a"),
      "delivery-a",
    )

    assertEquals("delivery-a", ring)
  }

  @Test
  fun `ring evicts oldest beyond capacity`() {
    var ring: String? = null
    for (index in 0 until RavenCatCompanionCompletionRing.MAX_RECENT_COMPLETION_DELIVERY_IDS + 2) {
      ring = RavenCatCompanionCompletionRing.append(ring, "delivery-$index")
    }

    assertFalse(RavenCatCompanionCompletionRing.contains(ring, "delivery-0"))
    assertFalse(RavenCatCompanionCompletionRing.contains(ring, "delivery-1"))
    assertTrue(RavenCatCompanionCompletionRing.contains(ring, "delivery-2"))
    assertEquals(
      RavenCatCompanionCompletionRing.MAX_RECENT_COMPLETION_DELIVERY_IDS,
      ring!!.split("\n").size,
    )
  }

  @Test
  fun `empty or blank serialized ring contains nothing`() {
    assertFalse(RavenCatCompanionCompletionRing.contains(null, "delivery-a"))
    assertFalse(RavenCatCompanionCompletionRing.contains("", "delivery-a"))
    assertFalse(RavenCatCompanionCompletionRing.contains("delivery-a", ""))
  }

  /**
   * delivery identity 是 `scheduleId@projectionToken`，不是 resolved eventId：
   * 同一个 schedule 的新 projection 必须能独立结案，不能被旧 projection 的回执拦掉。
   */
  @Test
  fun `same schedule with a new projection is not blocked by the previous delivery`() {
    val ring = RavenCatCompanionCompletionRing.append(null, "schedule-a@token-1")

    assertTrue(RavenCatCompanionCompletionRing.contains(ring, "schedule-a@token-1"))
    assertFalse(RavenCatCompanionCompletionRing.contains(ring, "schedule-a@token-2"))
    assertFalse(
      "resolved eventId 不得被当成 delivery identity 命中",
      RavenCatCompanionCompletionRing.contains(ring, "schedule-a"),
    )
  }

  @Test
  fun `delivery identity is stored verbatim`() {
    val ring = RavenCatCompanionCompletionRing.append(null, "schedule-a@token-1")

    assertEquals("schedule-a@token-1", ring)
  }
}
