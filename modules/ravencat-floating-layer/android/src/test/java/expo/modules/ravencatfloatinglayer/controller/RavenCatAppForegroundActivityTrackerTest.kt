package expo.modules.ravencatfloatinglayer.controller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatAppForegroundActivityTrackerTest {
  private class FakeScheduler : RavenCatDelayScheduler {
    val pending = mutableListOf<() -> Unit>()
    override fun schedule(delayMs: Long, action: () -> Unit): RavenCatScheduledTask {
      pending.add(action)
      return RavenCatScheduledTask { pending.remove(action) }
    }
  }

  private class Harness {
    val scheduler = FakeScheduler()
    val events = mutableListOf<Boolean>()
    val tracker = RavenCatAppForegroundActivityTracker(scheduler) { events.add(it) }
  }

  @Test
  fun `activity resume immediately reports foreground even without host bridge`() {
    val harness = Harness()

    harness.tracker.onActivityResumed()

    assertTrue(harness.tracker.isForeground)
    assertEquals(listOf(true), harness.events)
  }

  @Test
  fun `intra app activity transition never flashes background`() {
    val harness = Harness()

    harness.tracker.onActivityResumed() // Activity A
    harness.tracker.onActivityPaused() // A pause：安排 deferred release
    assertEquals(1, harness.scheduler.pending.size)
    harness.tracker.onActivityResumed() // Activity B resume：取消待释放

    assertTrue("B resume 必须取消 A pause 的待释放", harness.scheduler.pending.isEmpty())
    assertEquals(listOf(true), harness.events)
    assertTrue(harness.tracker.isForeground)
  }

  @Test
  fun `background is released only after deferred task runs with no resumed activity`() {
    val harness = Harness()

    harness.tracker.onActivityResumed()
    harness.tracker.onActivityPaused()
    assertTrue("deferred release 执行前仍视为前台", harness.tracker.isForeground)

    harness.scheduler.pending.removeAt(0).invoke()

    assertFalse(harness.tracker.isForeground)
    assertEquals(listOf(true, false), harness.events)
  }

  @Test
  fun `stale deferred release does not fire after a new resume`() {
    val harness = Harness()

    harness.tracker.onActivityResumed()
    harness.tracker.onActivityPaused()
    harness.tracker.onActivityResumed() // 取消第一次 pause 的 release
    harness.tracker.onActivityPaused() // 最后一次 pause：重新安排
    harness.scheduler.pending.removeAt(0).invoke()

    assertFalse(harness.tracker.isForeground)
    assertEquals(listOf(true, false), harness.events)
  }

  @Test
  fun `multiple resumed activities require all paused before background`() {
    val harness = Harness()

    harness.tracker.onActivityResumed()
    harness.tracker.onActivityResumed()
    harness.tracker.onActivityPaused()
    assertTrue("仍有 resumed Activity 时不得安排释放", harness.scheduler.pending.isEmpty())
    assertTrue(harness.tracker.isForeground)

    harness.tracker.onActivityPaused()
    harness.scheduler.pending.removeAt(0).invoke()
    assertFalse(harness.tracker.isForeground)
    assertEquals(listOf(true, false), harness.events)
  }
}
