package expo.modules.conversationturnruntime

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import expo.modules.kotlin.Promise
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentHashMap

/** 只记录原生宿主的启动回执与一次执行期；不存聊天输入、不 claim 或重试业务。 */
internal object ConversationTurnHostLifetime {
  const val EXECUTION_TIMEOUT_MS = 540_000L
  private val handler = Handler(Looper.getMainLooper())
  private val starts = ConcurrentHashMap<String, Promise>()
  private class Execution(val deadline: Long) {
    val stopped = CompletableDeferred<String>()
    var observed = false
    var finished = false
  }
  private val executions = ConcurrentHashMap<String, Execution>()

  fun request(id: String, promise: Promise) {
    check(starts.putIfAbsent(id, promise) == null)
    handler.postDelayed({ starts.remove(id)?.resolve(false) }, 5_000L)
  }

  fun accept(id: String): Boolean {
    val promise = starts.remove(id) ?: return false
    check(executions.putIfAbsent(id, Execution(SystemClock.elapsedRealtime() + EXECUTION_TIMEOUT_MS)) == null)
    promise.resolve(true)
    return true
  }

  fun reject(id: String) { starts.remove(id)?.resolve(false) }

  suspend fun awaitStop(id: String): String {
    val execution = checkNotNull(executions[id]) { "未知聊天执行宿主：$id" }
    val reason = execution.stopped.await()
    synchronized(execution) {
      execution.observed = true
      if (execution.finished) executions.remove(id, execution)
    }
    return reason
  }

  fun stop(id: String, reason: String) { executions[id]?.stopped?.complete(reason) }

  fun remaining(id: String): Double = (checkNotNull(executions[id]).deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0L).toDouble()

  fun finish(id: String) {
    val execution = checkNotNull(executions[id]) { "未知聊天执行宿主：$id" }
    synchronized(execution) {
      execution.stopped.complete("completed")
      execution.finished = true
      if (execution.observed) executions.remove(id, execution)
    }
  }
}
