package expo.modules.ravencatfloatinglayer

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

internal data class RavenCatFloatingMessageTaskRequest(
  val action: String,
  val text: String,
  val correlationId: String,
  val createdAtEpochMs: Long,
  val screenshotCorrelationId: String? = null,
)

/** 以 correlation 为键保存全部悬浮请求，避免并发任务互相覆盖恢复证据。 */
internal object RavenCatFloatingMessageTaskStore {
  private const val PREFS_NAME = "ravencat_floating_message_task"
  private const val KEY_PENDING_TASKS_JSON = "pendingTasksJson"
  private const val KEY_PENDING_ACTION = "pendingAction"
  private const val KEY_PENDING_TEXT = "pendingText"
  private const val KEY_PENDING_CORRELATION_ID = "pendingCorrelationId"
  private const val KEY_PENDING_CREATED_AT_EPOCH_MS = "pendingCreatedAtEpochMs"
  private const val KEY_LAST_START_ACCEPTED = "lastStartAccepted"
  private const val KEY_LAST_ERROR = "lastError"
  private const val KEY_LAST_COMPLETED_AT_EPOCH_MS = "lastCompletedAtEpochMs"
  private const val KEY_LAST_COMPLETION_SUCCEEDED = "lastCompletionSucceeded"

  @Synchronized
  fun recordPending(context: Context, request: RavenCatFloatingMessageTaskRequest) {
    val pending = readPendingTasks(context)
      .filterNot { it.correlationId == request.correlationId }
      .plus(request)
    val stored = prefs(context).edit()
      .putString(KEY_PENDING_TASKS_JSON, encode(pending))
      .putBoolean(KEY_LAST_START_ACCEPTED, false)
      .remove(KEY_LAST_ERROR)
      .removeLegacyPending()
      .commit()
    check(stored) { "无法持久化 RavenCat 悬浮消息后台请求" }
  }

  fun recordStartAccepted(context: Context) {
    prefs(context).edit()
      .putBoolean(KEY_LAST_START_ACCEPTED, true)
      .remove(KEY_LAST_ERROR)
      .apply()
  }

  fun recordStartFailed(context: Context, correlationId: String, error: String) {
    recordCompletion(context, correlationId, false, error)
    prefs(context).edit().putBoolean(KEY_LAST_START_ACCEPTED, false).apply()
  }

  @Synchronized
  fun recordCompletion(
    context: Context,
    correlationId: String,
    succeeded: Boolean,
    error: String?,
  ) {
    val remaining = readPendingTasks(context)
      .filterNot { it.correlationId == correlationId }
    val editor = prefs(context).edit()
      .putString(KEY_PENDING_TASKS_JSON, encode(remaining))
      .putLong(KEY_LAST_COMPLETED_AT_EPOCH_MS, System.currentTimeMillis())
      .putBoolean(KEY_LAST_COMPLETION_SUCCEEDED, succeeded)
      .putString(KEY_LAST_ERROR, error)
    if (remaining.isEmpty()) {
      editor.remove(KEY_PENDING_TASKS_JSON)
    }
    editor.removeLegacyPending().apply()
  }

  /** 恢复出厂：清空全部悬浮消息任务，防止旧悬浮请求在进程恢复时被读取。 */
  fun clearAllForFactoryReset(context: Context) {
    check(prefs(context).edit().clear().commit()) {
      "无法清空 RavenCat floating message task store"
    }
  }

  @Synchronized
  fun readPendingTasks(context: Context): List<RavenCatFloatingMessageTaskRequest> {
    val preferences = prefs(context)
    val encoded = preferences.getString(KEY_PENDING_TASKS_JSON, null)
    val current = if (encoded.isNullOrBlank()) emptyList() else decode(encoded)
    val legacyCorrelationId = preferences.getString(KEY_PENDING_CORRELATION_ID, null)
      ?.takeIf { it.isNotBlank() }
      ?: return current
    if (current.any { it.correlationId == legacyCorrelationId }) {
      return current
    }
    return current + RavenCatFloatingMessageTaskRequest(
      action = preferences.getString(KEY_PENDING_ACTION, null) ?: "message",
      text = preferences.getString(KEY_PENDING_TEXT, null).orEmpty(),
      correlationId = legacyCorrelationId,
      createdAtEpochMs = preferences.getLong(
        KEY_PENDING_CREATED_AT_EPOCH_MS,
        System.currentTimeMillis(),
      ),
    )
  }

  private fun encode(requests: List<RavenCatFloatingMessageTaskRequest>): String {
    val array = JSONArray()
    requests.forEach { request ->
      array.put(JSONObject().apply {
        put("action", request.action)
        put("text", request.text)
        put("correlationId", request.correlationId)
        put("createdAtEpochMs", request.createdAtEpochMs)
        put("screenshotCorrelationId", request.screenshotCorrelationId)
      })
    }
    return array.toString()
  }

  private fun decode(encoded: String): List<RavenCatFloatingMessageTaskRequest> {
    return try {
      val array = JSONArray(encoded)
      buildList {
        for (index in 0 until array.length()) {
          val item = array.getJSONObject(index)
          val correlationId = item.getString("correlationId").trim()
          if (correlationId.isNotEmpty()) {
            add(RavenCatFloatingMessageTaskRequest(
              action = item.optString("action", "message"),
              text = item.optString("text", ""),
              correlationId = correlationId,
              createdAtEpochMs = item.optLong("createdAtEpochMs", System.currentTimeMillis()),
              screenshotCorrelationId = item.optString("screenshotCorrelationId").takeIf { it.isNotEmpty() },
            ))
          }
        }
      }
    } catch (_: Exception) {
      emptyList()
    }
  }

  private fun android.content.SharedPreferences.Editor.removeLegacyPending() =
    remove(KEY_PENDING_ACTION)
      .remove(KEY_PENDING_TEXT)
      .remove(KEY_PENDING_CORRELATION_ID)
      .remove(KEY_PENDING_CREATED_AT_EPOCH_MS)

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
}
