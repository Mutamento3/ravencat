package expo.modules.ravencatfloatinglayer

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/** 让悬浮消息在宿主 Activity 和普通 React 页面均不存在时仍能完成。 */
class RavenCatFloatingMessageHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.fromBundle(extras),
      TASK_TIMEOUT_MS,
      true,
    )
  }

  companion object {
    const val TASK_KEY = "RavenCatFloatingMessageTask"
    private const val TASK_TIMEOUT_MS = 600_000L
    private const val TAG = "RavenCatFloatingTask"

    internal fun start(
      context: Context,
      request: RavenCatFloatingMessageTaskRequest,
      persistBeforeStart: Boolean = true,
    ): Boolean {
      if (persistBeforeStart) {
        try {
          RavenCatFloatingMessageTaskStore.recordPending(context, request)
        } catch (error: RuntimeException) {
          Log.e(TAG, "Unable to persist floating message task", error)
          return false
        }
      }

      val intent = Intent(context, RavenCatFloatingMessageHeadlessTaskService::class.java).apply {
        putExtras(request.toBundle())
      }
      return try {
        acquireWakeLockNow(context)
        context.startService(intent)
        RavenCatFloatingMessageTaskStore.recordStartAccepted(context)
        true
      } catch (error: RuntimeException) {
        val message = error.message ?: error.javaClass.simpleName
        RavenCatFloatingMessageTaskStore.recordStartFailed(
          context,
          request.correlationId,
          message,
        )
        Log.e(TAG, "Unable to start floating message Headless JS task", error)
        false
      }
    }

    private fun RavenCatFloatingMessageTaskRequest.toBundle(): Bundle {
      return Bundle().apply {
        putString("action", action)
        putString("text", text)
        putString("correlationId", correlationId)
        putDouble("createdAtEpochMs", createdAtEpochMs.toDouble())
        putString("screenshotCorrelationId", screenshotCorrelationId)
      }
    }
  }
}
