package expo.modules.ravencatfloatinglayer.controller

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatScreenshotVisibilityCoordinatorTest {
  @Test
  fun `success failure and timeout restore exactly once`() {
    val fixture = Fixture()

    fixture.coordinator.begin("success")
    fixture.scheduler.run(300L)
    assertEquals(listOf("success"), fixture.ready)
    assertTrue(fixture.coordinator.complete("success", succeeded = true))
    assertFalse(fixture.coordinator.complete("success", succeeded = true))

    fixture.coordinator.begin("failure")
    assertTrue(fixture.coordinator.complete("failure", succeeded = false))

    fixture.coordinator.begin("timeout")
    fixture.scheduler.run(8_000L)

    assertEquals(3, fixture.visibility.releaseCount)
    assertEquals(
      listOf(
        RavenCatOverlaySuppressionReason.SCREEN_CAPTURE,
        RavenCatOverlaySuppressionReason.SCREEN_CAPTURE,
        RavenCatOverlaySuppressionReason.SCREEN_CAPTURE,
      ),
      fixture.visibility.releasedReasons,
    )
    assertEquals(
      listOf(
        "success" to RavenCatScreenshotVisibilityResult.SUCCEEDED,
        "failure" to RavenCatScreenshotVisibilityResult.FAILED,
        "timeout" to RavenCatScreenshotVisibilityResult.TIMED_OUT,
      ),
      fixture.results,
    )
  }

  @Test
  fun `stale callback cannot restore a newer hidden request`() {
    val fixture = Fixture()
    fixture.coordinator.begin("old")
    fixture.coordinator.begin("new")

    assertFalse(fixture.coordinator.complete("old", succeeded = true))
    assertEquals(0, fixture.visibility.releaseCount)
    assertTrue(fixture.coordinator.complete("new", succeeded = true))
    assertEquals(1, fixture.visibility.acquireCount)
    assertEquals(1, fixture.visibility.releaseCount)
  }

  @Test
  fun `cancelled callbacks cannot affect a newer request with the same id`() {
    val fixture = Fixture()
    fixture.coordinator.begin("same")
    fixture.coordinator.begin("same")

    // 模拟已进入执行队列、无法靠取消定时任务阻止的旧回调。
    fixture.scheduler.runEvenIfCancelled(0)
    fixture.scheduler.runEvenIfCancelled(1)
    assertTrue(fixture.ready.isEmpty())
    assertTrue(fixture.results.isEmpty())
    assertEquals(0, fixture.visibility.releaseCount)

    fixture.scheduler.run(300L)
    assertEquals(listOf("same"), fixture.ready)
    assertTrue(fixture.coordinator.complete("same", succeeded = true))
    assertEquals(1, fixture.visibility.releaseCount)
    assertEquals(listOf("same" to RavenCatScreenshotVisibilityResult.SUCCEEDED), fixture.results)
  }

  private class Fixture {
    val visibility = FakeVisibilityHost()
    val scheduler = FakeDelayScheduler()
    val ready = mutableListOf<String>()
    val results = mutableListOf<Pair<String, RavenCatScreenshotVisibilityResult>>()
    val coordinator = RavenCatScreenshotVisibilityCoordinator(
      visibilityHost = visibility,
      scheduler = scheduler,
      onCaptureReady = ready::add,
      onVisibilityResult = { requestId, result -> results.add(requestId to result) },
    )
  }

  private class FakeVisibilityHost : RavenCatOverlayVisibilityHost {
    var acquireCount = 0
    var releaseCount = 0
    val acquiredReasons = mutableListOf<RavenCatOverlaySuppressionReason>()
    val releasedReasons = mutableListOf<RavenCatOverlaySuppressionReason>()

    override fun acquireSuppression(reason: RavenCatOverlaySuppressionReason) {
      acquireCount += 1
      acquiredReasons.add(reason)
    }

    override fun releaseSuppression(reason: RavenCatOverlaySuppressionReason) {
      releaseCount += 1
      releasedReasons.add(reason)
    }
  }

  private class FakeDelayScheduler : RavenCatDelayScheduler {
    private val tasks = mutableListOf<Task>()
    override fun schedule(delayMs: Long, action: () -> Unit): RavenCatScheduledTask {
      val task = Task(delayMs, action)
      tasks.add(task)
      return RavenCatScheduledTask { task.cancelled = true }
    }

    fun run(delayMs: Long) {
      tasks.filter { it.delayMs == delayMs && !it.cancelled }.toList().forEach { task ->
        task.cancelled = true
        task.action()
      }
    }

    fun runEvenIfCancelled(index: Int) {
      tasks[index].action()
    }

    private data class Task(
      val delayMs: Long,
      val action: () -> Unit,
      var cancelled: Boolean = false,
    )
  }
}
