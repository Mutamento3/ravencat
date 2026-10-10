package expo.modules.callruntime

import com.facebook.react.bridge.ReactContext
import android.content.Intent
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.UUID

/** 只保存当前进程的资源身份与待回执命令；业务状态仍由 Calls 提交。 */
internal object CallExecutionRegistry {
  var host: CallExecutionService? = null
  var executionContext: ReactContext? = null
  var callId: String? = null
  var alive = false
  var appVisible = false
  var ready = CompletableDeferred<Unit>()
  var released = CompletableDeferred<Unit>().apply { complete(Unit) }
  var emit: ((String, Map<String, Any?>) -> Unit)? = null
  private val commands = linkedMapOf<String, Pair<Map<String, Any?>, CompletableDeferred<Unit>>>()
  private val admission = Mutex()

  suspend fun start(context: ReactContext, options: Map<String, Any?>) = admission.withLock {
    val id = options["callId"] as String
    if (alive) {
      check(callId == id) { "另一通电话正在执行" }
      ready.await()
      return@withLock
    }
    // 这是资源释放 barrier，不重试、不猜测 Android 何时完成 stopSelf。
    released.await()
    callId = id
    executionContext = context
    alive = true
    ready = CompletableDeferred()
    released = CompletableDeferred()
    commands.clear()
    try {
      val intent = Intent(context, CallExecutionService::class.java).apply {
        putExtra("callId", id)
        putExtra("name", options["name"] as String)
        putExtra("avatarUri", options["avatarUri"] as String?)
        putExtra("direction", options["direction"] as String)
        putExtra("returnUri", options["returnUri"] as String)
      }
      context.startForegroundService(intent)
      withTimeout(30_000) { ready.await() }
    } catch (failure: Exception) {
      if (callId == id) {
        alive = false
        host?.finish()
        if (host == null) { released.complete(Unit); executionContext = null }
        ready.completeExceptionally(failure)
      }
      throw failure
    }
  }

  fun requireHost(id: String): CallExecutionService {
    check(alive && callId == id) { "通话执行已经结束" }
    return checkNotNull(host)
  }

  suspend fun command(action: String, muted: Boolean = false) {
    check(alive) { "通话执行已经结束" }
    val requestId = UUID.randomUUID().toString()
    val data = mapOf("callId" to checkNotNull(callId), "requestId" to requestId, "action" to action, "muted" to muted)
    val reply = CompletableDeferred<Unit>()
    commands[requestId] = data to reply
    emit?.invoke("onCommand", data)
    try {
      // 系统回调有 5 秒事务上限；只等待 Calls 动作，不等待模型和 TTS 网络。
      withTimeout(4_000) { reply.await() }
    } finally {
      commands.remove(requestId)
    }
  }

  fun pending(id: String): List<Map<String, Any?>> =
    if (id == callId) commands.values.map { it.first } else emptyList()

  fun acknowledge(id: String, error: String?) {
    val reply = commands[id]?.second ?: return
    if (error == null) reply.complete(Unit) else reply.completeExceptionally(IllegalStateException(error))
  }

  fun cancelled(service: CallExecutionService) {
    if (host !== service) return
    alive = false
    host = null
    executionContext = null
    released.complete(Unit)
    if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException("通话宿主已停止"))
    emit?.invoke("onCancelled", mapOf("callId" to checkNotNull(callId)))
  }
}
