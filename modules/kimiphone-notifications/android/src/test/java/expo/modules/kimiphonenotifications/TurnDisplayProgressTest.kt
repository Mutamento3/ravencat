package expo.modules.kimiphonenotifications

import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.async
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.cancelAndJoin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class TurnDisplayProgressTest {
  @Test
  fun `one rollback cannot reopen another concurrent close`() = runBlocking {
    val runId = "concurrent-closes"
    MessageArrivalProgress.setTurnDisplayActive(runId, true)
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), false)
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), false)
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), true)
    assertFalse(MessageArrivalProgress.awaitTurnDisplay(runId, "ai:concurrent"))
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), true)
    assertTrue(MessageArrivalProgress.awaitTurnDisplay(runId, "ai:concurrent"))
    MessageArrivalProgress.setTurnDisplayActive(runId, false)
  }
  @Test
  fun `closing a turn while its next segment waits rejects that segment`() = runBlocking {
    val key = "ai:in-flight"
    listOf("first", "closing-in-flight", "new-turn").forEach { MessageArrivalProgress.setTurnDisplayActive(it, true) }
    assertTrue(MessageArrivalProgress.awaitTurnDisplay("first", key))
    val waiting = async(start = CoroutineStart.UNDISPATCHED) {
      MessageArrivalProgress.awaitTurnDisplay("closing-in-flight", key)
    }
    MessageArrivalProgress.setTurnDisplayOpen(listOf("closing-in-flight"), false)
    assertFalse(waiting.await())
    assertTrue(MessageArrivalProgress.awaitTurnDisplay("new-turn", key))
    listOf("first", "closing-in-flight", "new-turn").forEach { MessageArrivalProgress.setTurnDisplayActive(it, false) }
  }

  @Test
  fun `closed turn cannot publish late notification or release a segment`() = runBlocking {
    val runId = "interrupted-turn"
    MessageArrivalProgress.setTurnDisplayActive(runId, true)
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), false)
    assertFalse(MessageArrivalProgress.awaitTurnDisplay(runId, "ai:test"))
    var publications = 0
    assertEquals(false, MessageArrivalProgress.publishTurn(runId, false) { publications++; true })
    assertEquals(0, publications)
    // T1 回滚恢复原批次，不影响其他 run。
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), true)
    assertTrue(MessageArrivalProgress.awaitTurnDisplay(runId, "ai:test-resumed"))
    assertEquals(true, MessageArrivalProgress.publishTurn(runId, false) { true })
    MessageArrivalProgress.setTurnDisplayActive(runId, false)
  }

  @Test
  fun `retiring a waiting turn rejects late arrival notification and rollback without tombstone`() = runBlocking {
    val runId = "retired-waiter"
    val key = "ai:retirement"
    MessageArrivalProgress.setTurnDisplayActive(runId, true)
    assertTrue(MessageArrivalProgress.awaitTurnDisplay(runId, key))
    val waiting = async(start = CoroutineStart.UNDISPATCHED) { MessageArrivalProgress.awaitTurnDisplay(runId, key) }
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), false)
    MessageArrivalProgress.setTurnDisplayActive(runId, false)
    // 释放后的 T1 回滚只能释放自己的关闭，不得重新注册旧 run。
    MessageArrivalProgress.setTurnDisplayOpen(listOf(runId), true)
    assertFalse(waiting.await())
    assertFalse(MessageArrivalProgress.awaitTurnDisplay(runId, key))
    assertFalse(MessageArrivalProgress.publishTurn(runId, false) { true })
    assertTrue(MessageArrivalProgress.publishTurn(null, false) { true })
    MessageArrivalProgress.setTurnDisplayActive("fresh-turn", true)
    assertTrue(MessageArrivalProgress.awaitTurnDisplay("fresh-turn", key))
    MessageArrivalProgress.setTurnDisplayActive("fresh-turn", false)
  }

  @Test
  fun `clearing arrival data keeps one mutex for existing and new waiters`() = runBlocking {
    val runId = "clock-clear"
    val key = "ai:clock-clear"
    MessageArrivalProgress.setTurnDisplayActive(runId, true)
    assertTrue(MessageArrivalProgress.awaitTurnDisplay(runId, key))
    val waiting = async(start = CoroutineStart.UNDISPATCHED) { MessageArrivalProgress.awaitTurnDisplay(runId, key) }
    MessageArrivalProgress.clear()
    val next = async(start = CoroutineStart.UNDISPATCHED) { MessageArrivalProgress.awaitTurnDisplay(runId, key) }
    assertFalse(next.isCompleted)
    waiting.cancelAndJoin()
    assertTrue(next.await())
    MessageArrivalProgress.setTurnDisplayActive(runId, false)
  }
}
