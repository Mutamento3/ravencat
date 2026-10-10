package expo.modules.ravencatfloatinglayer.controller

import android.os.Handler

internal interface RavenCatOverlayVisibilityHost {
  fun acquireSuppression(reason: RavenCatOverlaySuppressionReason)
  fun releaseSuppression(reason: RavenCatOverlaySuppressionReason)
}

internal fun interface RavenCatScheduledTask {
  fun cancel()
}

internal fun interface RavenCatDelayScheduler {
  fun schedule(delayMs: Long, action: () -> Unit): RavenCatScheduledTask
}

internal class RavenCatHandlerDelayScheduler(
  private val handler: Handler,
) : RavenCatDelayScheduler {
  override fun schedule(delayMs: Long, action: () -> Unit): RavenCatScheduledTask {
    val runnable = Runnable(action)
    handler.postDelayed(runnable, delayMs)
    return RavenCatScheduledTask { handler.removeCallbacks(runnable) }
  }
}

internal enum class RavenCatScreenshotVisibilityResult {
  SUCCEEDED,
  FAILED,
  TIMED_OUT,
}

/** 用请求身份保护截图隐藏周期，过期或重复回调不能恢复更新请求的窗口。 */
internal class RavenCatScreenshotVisibilityCoordinator(
  private val visibilityHost: RavenCatOverlayVisibilityHost,
  private val scheduler: RavenCatDelayScheduler,
  private val settleDelayMs: Long = 300L,
  private val timeoutMs: Long = 8_000L,
  private val onCaptureReady: (requestId: String) -> Unit,
  private val onVisibilityResult: (requestId: String, result: RavenCatScreenshotVisibilityResult) -> Unit,
) {
  private var generation = 0L
  private var activeRequest: ActiveRequest? = null

  @Synchronized
  fun begin(requestId: String) {
    require(requestId.isNotBlank()) { "截图请求身份不能为空" }
    generation += 1
    val requestGeneration = generation
    val previous = activeRequest
    previous?.settleTask?.cancel()
    previous?.timeoutTask?.cancel()
    if (previous == null) {
      visibilityHost.acquireSuppression(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    }

    val next = ActiveRequest(requestId, requestGeneration)
    activeRequest = next
    next.settleTask = scheduler.schedule(settleDelayMs) {
      markCaptureReady(requestId, requestGeneration)
    }
    next.timeoutTask = scheduler.schedule(timeoutMs) {
      finish(requestId, requestGeneration, RavenCatScreenshotVisibilityResult.TIMED_OUT)
    }
  }

  fun complete(requestId: String, succeeded: Boolean): Boolean {
    val request = synchronized(this) { activeRequest }
    return finish(
      requestId,
      request?.generation ?: -1L,
      if (succeeded) {
        RavenCatScreenshotVisibilityResult.SUCCEEDED
      } else {
        RavenCatScreenshotVisibilityResult.FAILED
      },
    )
  }

  @Synchronized
  fun cancelAll() {
    val request = activeRequest ?: return
    request.settleTask?.cancel()
    request.timeoutTask?.cancel()
    activeRequest = null
    visibilityHost.releaseSuppression(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
  }

  private fun markCaptureReady(requestId: String, requestGeneration: Long) {
    val shouldDispatch = synchronized(this) {
      val request = activeRequest
      val matches = request != null &&
        request.requestId == requestId &&
        request.generation == requestGeneration &&
        !request.captureDispatched
      if (matches) {
        request?.captureDispatched = true
      }
      matches
    }
    if (!shouldDispatch) return
    onCaptureReady(requestId)
  }

  private fun finish(
    requestId: String,
    requestGeneration: Long,
    result: RavenCatScreenshotVisibilityResult,
  ): Boolean {
    val completed = synchronized(this) {
      val request = activeRequest
      if (
        request == null ||
        request.requestId != requestId ||
        request.generation != requestGeneration
      ) {
        return@synchronized null
      }
      request.settleTask?.cancel()
      request.timeoutTask?.cancel()
      activeRequest = null
      request
    } ?: return false

    visibilityHost.releaseSuppression(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    onVisibilityResult(completed.requestId, result)
    return true
  }

  private data class ActiveRequest(
    val requestId: String,
    val generation: Long,
    var captureDispatched: Boolean = false,
    var settleTask: RavenCatScheduledTask? = null,
    var timeoutTask: RavenCatScheduledTask? = null,
  )
}
