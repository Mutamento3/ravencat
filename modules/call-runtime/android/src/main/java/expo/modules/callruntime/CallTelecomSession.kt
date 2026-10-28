package expo.modules.callruntime

import android.telecom.DisconnectCause
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallException
import kotlinx.coroutines.*

/** 本通电话的系统会话所有者；注册、激活与断开共用寿命，不等待 JS 才释放 Telecom。 */
internal class CallTelecomSession(
  private val scope: CoroutineScope,
  private val addCall: suspend (CallControlScope.() -> Unit) -> Unit,
  private val onEnded: () -> Unit,
) {
  val audioScope = CoroutineScope(scope.coroutineContext + SupervisorJob(scope.coroutineContext[Job]) +
    CoroutineExceptionHandler { _, failure ->
      activation?.completeExceptionally(failure)
      if (closing == null) onEnded()
    })
  private val registered = CompletableDeferred<CallControlScope?>()
  private var sessionJob: Job? = null
  private var activation: CompletableDeferred<Unit>? = null
  private var closing: CompletableDeferred<Unit>? = null
  private var endedNormally = false

  suspend fun activate(connectAudio: suspend (CallControlScope) -> Unit) {
    activation?.let { it.await(); return }
    check(closing == null) { "通话已经结束" }
    val established = CompletableDeferred<Unit>()
    activation = established
    // 先保存任务身份，防止注册同步失败时的结束回调漏掉尚未赋值的任务。
    sessionJob = scope.launch(start = CoroutineStart.LAZY) {
      try {
        addCall { registered.complete(this) }
        endedNormally = true
      } catch (failure: Exception) {
        established.completeExceptionally(failure)
      } finally {
        registered.complete(null)
        established.completeExceptionally(IllegalStateException("系统通话已经结束"))
        if (closing == null) onEnded()
      }
    }
    audioScope.launch {
      try {
        withTimeout(ACTIVATION_TIMEOUT_MS) {
          val control = checkNotNull(registered.await()) { "系统未建立通话会话" }
          connectAudio(control)
        }
        established.complete(Unit)
      } catch (failure: Exception) {
        val cause = if (failure is TimeoutCancellationException) {
          IllegalStateException("系统通话音频建立超时", failure)
        } else failure
        established.completeExceptionally(cause)
        if (closing == null) onEnded()
      }
    }
    sessionJob!!.start()
    established.await()
  }

  fun close(): Deferred<Unit> {
    closing?.let { return it }
    val released = CompletableDeferred<Unit>()
    closing = released
    activation?.completeExceptionally(IllegalStateException("通话已经结束"))
    audioScope.cancel()
    scope.launch {
      try {
        withTimeout(RELEASE_TIMEOUT_MS) {
          val job = sessionJob
          if (job != null) {
            // 注册尚未返回时保留任务，迟到的句柄也必须断开，不能先取消并遗失它。
            val control = registered.await()
            if (control != null && !endedNormally) {
              when (val result = control.disconnect(DisconnectCause(DisconnectCause.LOCAL))) {
                is CallControlResult.Success -> Unit
                is CallControlResult.Error -> check(result.errorCode == CallException.ERROR_CALL_IS_NOT_BEING_TRACKED) {
                  "系统未能断开通话：$result"
                }
              }
            }
            job.join()
          }
        }
        released.complete(Unit)
      } catch (failure: Exception) {
        released.completeExceptionally(IllegalStateException("系统通话释放失败：${failure.message}", failure))
      } finally {
        sessionJob?.cancel()
      }
    }
    return released
  }

  companion object {
    private const val ACTIVATION_TIMEOUT_MS = 30_000L
    private const val RELEASE_TIMEOUT_MS = 10_000L
  }
}
