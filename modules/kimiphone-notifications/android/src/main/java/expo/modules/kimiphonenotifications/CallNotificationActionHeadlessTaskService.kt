package expo.modules.kimiphonenotifications

import android.content.Context
import android.content.Intent
import android.os.Bundle
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class CallNotificationActionHeadlessTaskService : HeadlessJsTaskService() {
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
    const val TASK_KEY = "KimiPhoneCallNotificationActionTask"
    private const val TASK_TIMEOUT_MS = 30_000L

    fun start(context: Context, response: Map<String, Any?>): Boolean {
      val intent = Intent(context, CallNotificationActionHeadlessTaskService::class.java).apply {
        putExtras(response.toBundle())
      }

      return try {
        acquireWakeLockNow(context)
        context.startService(intent)
        true
      } catch (_: RuntimeException) {
        false
      }
    }

    private fun Map<String, Any?>.toBundle(): Bundle {
      return Bundle().apply {
        this@toBundle.forEach { (key, value) ->
          when (value) {
            is String -> putString(key, value)
            is Long -> putLong(key, value)
            is Int -> putInt(key, value)
            is Boolean -> putBoolean(key, value)
          }
        }
      }
    }
  }
}
