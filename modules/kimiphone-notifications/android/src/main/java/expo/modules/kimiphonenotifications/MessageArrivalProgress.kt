package expo.modules.kimiphonenotifications

import android.os.SystemClock
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** 仅保存当前进程正在交付的消息 ID，不拥有消息提交、执行恢复或通知权限。 */
internal object MessageArrivalProgress {
  val observers = mutableSetOf<(Map<String, Any?>) -> Unit>()
  private val lock = Any()
  private var revision = 0L
  private val pending = linkedMapOf<Long, Map<String, Any?>>()
  private class ArrivalClock(val mutex: Mutex = Mutex(), var users: Int = 0, var lastArrivalAt: Long = 0L)
  private val clockGate = Any()
  private val clocks = mutableMapOf<String, ArrivalClock>()
  // 只保存活跃展示的关闭引用数；未知或已释放的 run 没有发布资格，不需要永久 tombstone。
  private val activeTurns = mutableMapOf<String, Int>()
  private val turnPublicationGate = Any()

  fun setTurnDisplayActive(runId: String, active: Boolean) = synchronized(turnPublicationGate) {
    if (active) {
      check(!activeTurns.containsKey(runId)) { "Turn display is already active: $runId" }
      activeTurns[runId] = 0
    } else activeTurns.remove(runId)
    Unit
  }

  fun setTurnDisplayOpen(runIds: List<String>, open: Boolean) {
    synchronized(turnPublicationGate) {
      // 并发 T1 各自拥有一次关闭；其中一个回滚不能开放另一个仍在关闭的批次。
      runIds.forEach { runId -> activeTurns[runId]?.let { count ->
        check(!open || count > 0) { "Turn display has no close to roll back: $runId" }
        activeTurns[runId] = if (open) count - 1 else count + 1
      } }
    }
  }

  /** 关闭与真正的原生发布共享边界，避免 JS 检查之后迟到的通知泄漏。 */
  fun <T> publishTurn(runId: String?, rejected: T, publish: () -> T): T = synchronized(turnPublicationGate) {
    if (runId != null && activeTurns[runId] != 0) rejected else publish()
  }

  private fun canPublish(runId: String): Boolean = synchronized(turnPublicationGate) { activeTurns[runId] == 0 }

  private suspend fun <T> withArrivalClock(conversationKey: String, operation: suspend (ArrivalClock) -> T): T {
    val clock = synchronized(clockGate) {
      val now = SystemClock.elapsedRealtime()
      // 超过分段间隔的空闲时钟不再影响节奏；等待者仍持有同一个 Mutex，不能在排队时移除。
      clocks.entries.removeAll { it.value.users == 0 && now - it.value.lastArrivalAt >= 1_000L }
      clocks.getOrPut(conversationKey) { ArrivalClock() }.also { it.users++ }
    }
    try { return clock.mutex.withLock { operation(clock) } }
    finally {
      synchronized(clockGate) {
        clock.users--
        if (clock.users == 0 && SystemClock.elapsedRealtime() - clock.lastArrivalAt >= 1_000L) clocks.remove(conversationKey)
      }
    }
  }

  private suspend fun pace(clock: ArrivalClock) {
    val last = synchronized(clockGate) { clock.lastArrivalAt }
    val waitMs = 1_000L - (SystemClock.elapsedRealtime() - last)
    if (waitMs > 0L) delay(waitMs)
  }

  private fun recordArrival(clock: ArrivalClock) = synchronized(clockGate) {
    clock.lastArrivalAt = SystemClock.elapsedRealtime()
  }

  /** 运行片段沿同一原生时钟到达；不要求 canonical message 已经存在。 */
  suspend fun awaitTurnDisplay(runId: String, conversationKey: String): Boolean {
    return withArrivalClock(conversationKey) { clock ->
      if (!canPublish(runId)) return@withArrivalClock false
      pace(clock)
      if (!canPublish(runId)) return@withArrivalClock false
      recordArrival(clock)
      true
    }
  }

  fun snapshot(): Map<String, Any?> = synchronized(lock) { snapshotLocked() }

  private fun snapshotLocked(): Map<String, Any?> = mapOf(
    "revision" to revision,
    "pendingMessageIds" to pending.keys.toList(),
    "pendingSessionIds" to pending.values.map { it["sessionId"] }.distinct(),
  )

  fun begin(observer: Map<String, Any?>, messageIds: List<Long>): Map<String, Any?> = synchronized(lock) {
    messageIds.forEach { pending[it] = observer }
    publishLocked(observer)
    snapshotLocked()
  }

  suspend fun awaitArrival(conversationKey: String, messageId: Long): Map<String, Any?> {
    return withArrivalClock(conversationKey) { clock ->
      // 与原有系统通知相同的会话间隔；原生挂起不依赖会被冻结的 JS timer。
      pace(clock)
      recordArrival(clock)
      synchronized(lock) {
        pending.remove(messageId)?.let { publishLocked(it) }
        snapshotLocked()
      }
    }
  }

  fun finish(messageIds: List<Long>): Map<String, Any?> = synchronized(lock) {
    val changed = messageIds.mapNotNull { pending.remove(it) }.distinct()
    changed.forEach { publishLocked(it) }
    snapshotLocked()
  }

  fun clear() = synchronized(lock) {
    val changed = pending.values.toList().distinct()
    pending.clear()
    synchronized(clockGate) {
      clocks.values.forEach { it.lastArrivalAt = 0L }
      clocks.entries.removeAll { it.value.users == 0 }
    }
    changed.forEach { publishLocked(it) }
  }

  private fun publishLocked(observer: Map<String, Any?>) {
    revision += 1
    val event = mapOf("snapshot" to snapshotLocked(), "observer" to observer)
    val callbacks = synchronized(observers) { observers.toList() }
    callbacks.forEach { it(event) }
  }
}
