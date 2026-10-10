package expo.modules.kimiphonenotifications

import android.os.SystemClock
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** 仅保存当前进程正在交付的消息 ID，不拥有消息提交、执行恢复或通知权限。 */
internal object MessageArrivalProgress {
  val observers = mutableSetOf<(Map<String, Any?>) -> Unit>()
  private val lock = Any()
  private var revision = 0L
  private val pending = linkedMapOf<Long, Map<String, Any?>>()
  private val arrivalMutexes = ConcurrentHashMap<String, Mutex>()
  private val lastArrivalAt = ConcurrentHashMap<String, Long>()

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
    return arrivalMutexes.computeIfAbsent(conversationKey) { Mutex() }.withLock {
      // 与原有系统通知相同的会话间隔；原生挂起不依赖会被冻结的 JS timer。
      val waitMs = 1_000L - (SystemClock.elapsedRealtime() - (lastArrivalAt[conversationKey] ?: 0L))
      if (waitMs > 0L) delay(waitMs)
      lastArrivalAt[conversationKey] = SystemClock.elapsedRealtime()
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
    lastArrivalAt.clear()
    changed.forEach { publishLocked(it) }
  }

  private fun publishLocked(observer: Map<String, Any?>) {
    revision += 1
    val event = mapOf("snapshot" to snapshotLocked(), "observer" to observer)
    val callbacks = synchronized(observers) { observers.toList() }
    callbacks.forEach { it(event) }
  }
}
