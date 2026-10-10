package expo.modules.ravencatfloatinglayer

import android.content.Context
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

/**
 * pending wake queue 与 completion dedupe identity 的 native 行为：
 * - 多条 AI Schedule 同时 pending 不能互相覆盖；
 * - completion dedupe 用 deliveryEventId（scheduleId@token），stale v1 不毒死 v2。
 */
@RunWith(RobolectricTestRunner::class)
class RavenCatCompanionWakeStorePendingQueueTest {
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
  fun `multiple pending ai schedule events survive and drain independently`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-a", "tok-a"))
    RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-b", "tok-b"))

    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    assertEquals(listOf("schedule-a", "schedule-b"), drained.map { it.eventId })
    assertEquals(
      listOf("schedule-a@tok-a", "schedule-b@tok-b"),
      drained.map { it.deliveryEventId },
    )
    assertEquals(listOf("tok-a", "tok-b"), drained.map { it.projectionToken })
    assertEquals(listOf("ai_schedule", "ai_schedule"), drained.map { it.triggerKind })

    // 消费后队列清空，不会重复投递。
    assertTrue(RavenCatCompanionWakeStore.consumeAllPending(context).isEmpty())
  }

  @Test
  fun `pending queue is bounded and keeps latest events`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    repeat(20) { index ->
      RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-$index", "tok-$index"))
    }
    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    // 只保留 bounded 尾部，但早期 head 之外的最近事件不丢。
    assertTrue(drained.size <= 16)
    assertEquals("schedule-19", drained.last().eventId)
  }

  @Test
  fun `self wake pending event round trips without ai schedule fields`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    RavenCatCompanionWakeStore.recordPending(
      context,
      RavenCatCompanionWakeEvent(
        wakeReason = "system_timer",
        source = "alarm-manager",
        eventId = "wake-1",
        createdAtEpochMs = 1_000L,
        scheduleRevision = 7L,
        hostAIId = "host-ai",
        deliveryEventId = "wake-1",
      ),
    )
    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    assertEquals(1, drained.size)
    assertEquals("wake-1", drained[0].eventId)
    assertEquals("wake-1", drained[0].deliveryEventId)
    assertEquals("alarm-manager", drained[0].source)
    assertEquals(null, drained[0].triggerKind)
    assertEquals(null, drained[0].projectionToken)
  }

  @Test
  fun `completion dedupes by delivery identity not schedule id`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    RavenCatCompanionWakeStore.recordRunnerCompletion(context, "schedule-a@tok-a", true, null)
    assertTrue(RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, "schedule-a@tok-a"))
    // stale v1 的 completion 不得毒死 v2 delivery identity。
    assertFalse(RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, "schedule-a@tok-b"))
    // Self Wake 兼容：wakeId 仍是独立 delivery identity。
    assertFalse(RavenCatCompanionWakeStore.hasRecentRunnerCompletion(context, "schedule-a"))
  }

  @Test
  fun `factory reset clears entire pending queue`() {
    RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-a", "tok-a"))
    RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-b", "tok-b"))
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    assertTrue(RavenCatCompanionWakeStore.consumeAllPending(context).isEmpty())
  }

  @Test
  fun `pending queue dedupes repeated same delivery identity`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    // 同一 projection 的重复 start failure：只保留最新一份，不填满队列。
    repeat(20) { index ->
      RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-a", "tok-a"))
    }
    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    assertEquals(1, drained.size)
    assertEquals("schedule-a@tok-a", drained[0].deliveryEventId)
  }

  @Test
  fun `pending queue keeps distinct delivery identities`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    // A/B 不同 delivery identity 都保留，即使 A 反复重复。
    repeat(5) { RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-a", "tok-a")) }
    RavenCatCompanionWakeStore.recordPending(context, aiScheduleEvent("schedule-b", "tok-b"))
    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    assertEquals(listOf("schedule-a@tok-a", "schedule-b@tok-b"), drained.map { it.deliveryEventId })
  }

  @Test
  fun `pending queue dedupes by delivery identity even without explicit deliveryEventId`() {
    RavenCatCompanionWakeStore.clearAllForFactoryReset(context)
    // 无 deliveryEventId 时回退 eventId 作为 delivery identity，仍去重。
    repeat(3) {
      RavenCatCompanionWakeStore.recordPending(
        context,
        RavenCatCompanionWakeEvent(
          wakeReason = "system_timer",
          source = "work-manager",
          eventId = "wake-same",
          createdAtEpochMs = 1_000L,
          hostAIId = "host-ai",
        ),
      )
    }
    val drained = RavenCatCompanionWakeStore.consumeAllPending(context)
    assertEquals(1, drained.size)
    assertEquals("wake-same", drained[0].eventId)
  }
}
