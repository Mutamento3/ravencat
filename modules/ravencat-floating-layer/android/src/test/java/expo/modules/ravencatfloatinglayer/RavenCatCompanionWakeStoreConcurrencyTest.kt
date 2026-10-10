package expo.modules.ravencatfloatinglayer

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import java.util.concurrent.CountDownLatch
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.TimeUnit

/**
 * 真正的并发 correctness 测试：
 * - recordPending 与 consumeAllPending 并发不会把新 event 清掉；
 * - completion ring 并发 append 不会丢失任一 delivery identity。
 */
@RunWith(RobolectricTestRunner::class)
class RavenCatCompanionWakeStoreConcurrencyTest {
  @Suppress("DEPRECATION")
  private val context: Context = RuntimeEnvironment.getApplication()

  private fun aiScheduleEvent(id: String, token: String) = RavenCatCompanionWakeEvent(
    wakeReason = "system_timer",
    source = "work-manager",
    eventId = id,
    createdAtEpochMs = 1_000L,
    hostAIId = "host-ai",
    triggerKind = "ai_schedule",
    expectedRemindAtEpochMs = 2_000L,
    projectionToken = token,
    deliveryEventId = "$id@$token",
  )

  @Test
  fun `concurrent recordPending and consumeAllPending never lose a new event`() {
    repeat(100) {
      RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
      RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-a", "tok-a"))

      val barrier = CyclicBarrier(2)
      val done = CountDownLatch(2)
      val drained = mutableListOf<RavenCatCompanionWakeEvent>()

      val consumer = Thread {
        barrier.await()
        drained.addAll(RavenCatCompanionWakeStore.consumeAllPending(context))
        done.countDown()
      }
      val producer = Thread {
        barrier.await()
        RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-b", "tok-b"))
        done.countDown()
      }
      consumer.start()
      producer.start()
      assertTrue(done.await(5, TimeUnit.SECONDS))

      val remaining = RavenCatCompanionWakeStore.consumeAllPending(context)
      val allSeen = drained + remaining
      // schedule-b 要么被消费、要么留在队列，但必须恰好出现一次（不丢、不重）。
      assertEquals(
        "schedule-b 并发下必须恰好出现一次",
        1,
        allSeen.count { it.deliveryEventId == "schedule-b@tok-b" },
      )
      // pre-loaded 的 schedule-a 必须被 consumer 消费。
      assertTrue(allSeen.any { it.deliveryEventId == "schedule-a@tok-a" })
    }
  }

  @Test
  fun `concurrent completion ring mutations keep both delivery ids`() {
    repeat(50) {
      RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
      val barrier = CyclicBarrier(2)
      val done = CountDownLatch(2)

      val first = Thread {
        barrier.await()
        RavenCatCompanionWakeStore.recordRunnerCompletion(context, "schedule-a@tok-a", true, null)
        done.countDown()
      }
      val second = Thread {
        barrier.await()
        RavenCatCompanionWakeStore.recordRunnerCompletion(context, "schedule-b@tok-b", true, null)
        done.countDown()
      }
      first.start()
      second.start()
      assertTrue(done.await(5, TimeUnit.SECONDS))

      assertTrue(RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, "schedule-a@tok-a"))
      assertTrue(RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, "schedule-b@tok-b"))
    }
  }

  @Test
  fun `factory reset is mutually exclusive with pending enqueue`() {
    repeat(50) {
      RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
      val barrier = CyclicBarrier(2)
      val done = CountDownLatch(2)

      val enqueue = Thread {
        barrier.await()
        RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-c", "tok-c"))
        done.countDown()
      }
      val reset = Thread {
        barrier.await()
        RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
        done.countDown()
      }
      enqueue.start()
      reset.start()
      assertTrue(done.await(5, TimeUnit.SECONDS))

      // 要么 enqueue 先于 reset（被清掉），要么 reset 先于 enqueue（保留）。不存在部分清空损坏。
      val remaining = RavenCatCompanionWakeStore.consumeAllPending(context)
      assertTrue(remaining.isEmpty() || remaining.size == 1)
    }
  }
}
