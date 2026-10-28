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
    check(callId != id || (alive && host?.finishing != true)) { "通话已经结束" }
    if (alive && host?.finishing != true) {
      check(callId == id) { "另一通电话正在执行" }
      ready.await()
      return@withLock
    }
    // 同时等待系统断开结果与服务销毁；失败不能伪装为空闲并注册下一通电话。
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
        putExtra("ringtoneUri", options["ringtoneUri"] as String?)
        putExtra("ringing", options["ringing"] as Boolean)
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

  suspend fun finish(id: String) {
    if (callId != id) return
    val completion = released
    alive = false
    val service = host
    if (service == null) {
      ready.completeExceptionally(IllegalStateException("通话已经结束"))
      return
    }
    service.finish().await()
    completion.await()
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

  fun cancelled(service: CallExecutionService, failure: Throwable?) {
    if (host !== service) return
    val id = checkNotNull(callId)
    alive = false
    // 唤醒启动等待者时仍保留宿主，避免它将“宿主刚销毁”误判为“服务从未启动”。
    if (!ready.isCompleted) ready.completeExceptionally(IllegalStateException("通话宿主已停止"))
    host = null
    executionContext = null
    // 唤醒新电话前发布旧身份，不能让同步恢复的 start 改写 callId 后再发送取消。
    try { emit?.invoke("onCancelled", mapOf("callId" to id)) }
    finally {
      if (failure == null) released.complete(Unit) else released.completeExceptionally(failure)
    }
  }
}
