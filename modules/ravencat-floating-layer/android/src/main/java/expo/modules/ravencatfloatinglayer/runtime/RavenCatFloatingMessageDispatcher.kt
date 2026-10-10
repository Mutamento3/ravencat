package expo.modules.ravencatfloatinglayer.runtime

import android.content.Context
import android.util.Log
import expo.modules.ravencatfloatinglayer.RavenCatFloatingMessageHeadlessTaskService
import expo.modules.ravencatfloatinglayer.RavenCatFloatingMessageTaskRequest
import expo.modules.ravencatfloatinglayer.RavenCatFloatingMessageTaskStore

/** 悬浮消息的 Headless 启动与过期恢复证据不属于 Overlay Service。 */
internal class RavenCatFloatingMessageDispatcher(
  private val context: Context,
) {
  fun dispatch(
    action: String,
    text: String,
    correlationId: String,
    screenshotCorrelationId: String? = null,
  ): Boolean {
    val accepted = RavenCatFloatingMessageHeadlessTaskService.start(
      context = context,
      request = RavenCatFloatingMessageTaskRequest(
        action = action,
        text = text,
        correlationId = correlationId,
        createdAtEpochMs = System.currentTimeMillis(),
        screenshotCorrelationId = screenshotCorrelationId,
      ),
    )
    Log.i(TAG, "悬浮任务 correlationId=$correlationId action=$action accepted=$accepted")
    return accepted
  }

  fun recoverStaleRequests(onRecovered: (RavenCatFloatingMessageTaskRequest, String) -> Unit) {
    RavenCatFloatingMessageTaskStore.readPendingTasks(context).forEach { pending ->
      val error = "进程重启后不能安全重放未完成的悬浮请求"
      RavenCatFloatingMessageTaskStore.recordCompletion(
        context = context,
        correlationId = pending.correlationId,
        succeeded = false,
        error = error,
      )
      onRecovered(pending, error)
    }
  }

  companion object {
    private const val TAG = "RavenCatFloatingTask"
  }
}
