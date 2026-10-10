package expo.modules.ravencatfloatinglayer

import android.content.Context
import expo.modules.ravencatfloatinglayer.model.RavenCatTogetherListeningPresentation
import org.json.JSONObject

/**
 * Floating Layer 自己持有的 Together projection cache。
 *
 * 这份 cache 不是 Together 真值，只为 Service/process attach 时恢复最后一次已提交
 * 的外部 presentation；它不包含 phase、媒体事实，也不驱动任何生命周期。
 */
internal object RavenCatTogetherListeningPresentationStore {
  private const val PREFERENCES_NAME = "ravencat_together_listening_projection"
  private const val KEY_PROJECTION_JSON = "projection_json"

  fun load(context: Context): RavenCatTogetherListeningPresentation? {
    val encoded = preferences(context).getString(KEY_PROJECTION_JSON, null)
      ?.takeIf { it.isNotBlank() }
      ?: return null
    return try {
      val json = JSONObject(encoded)
      RavenCatTogetherListeningPresentation(
        activityId = json.requiredString("activityId"),
        hostAiId = json.requiredString("hostAiId"),
        chatSessionId = json.requiredString("chatSessionId"),
        activatedAtEpochMs = json.getLong("activatedAtEpochMs"),
        aiName = json.requiredString("aiName"),
        aiAvatar = json.optionalString("aiAvatar"),
        userName = json.requiredString("userName"),
        userAvatar = json.optionalString("userAvatar"),
      )
    } catch (_: Exception) {
      // Projection cache 损坏时只丢弃 cache；Together truth 仍由 Host/SQLite 裁决。
      null
    }
  }

  fun save(context: Context, projection: RavenCatTogetherListeningPresentation) {
    val json = JSONObject().apply {
      put("activityId", projection.activityId)
      put("hostAiId", projection.hostAiId)
      put("chatSessionId", projection.chatSessionId)
      put("activatedAtEpochMs", projection.activatedAtEpochMs)
      put("aiName", projection.aiName)
      put("aiAvatar", projection.aiAvatar)
      put("userName", projection.userName)
      put("userAvatar", projection.userAvatar)
    }
    check(preferences(context).edit().putString(KEY_PROJECTION_JSON, json.toString()).commit()) {
      "无法保存 RavenCat Together Listening projection cache"
    }
  }

  /** requestedActivityId 不匹配当前 projection 时必须保留当前 Activity。 */
  fun matchesActivity(
    current: RavenCatTogetherListeningPresentation?,
    requestedActivityId: String?,
  ): Boolean {
    return requestedActivityId == null || current == null || current.activityId == requestedActivityId
  }

  fun clear(context: Context, requestedActivityId: String?): Boolean {
    val current = load(context)
    if (!matchesActivity(current, requestedActivityId)) {
      return false
    }
    if (current == null) {
      return false
    }
    check(preferences(context).edit().remove(KEY_PROJECTION_JSON).commit()) {
      "无法清除 RavenCat Together Listening projection cache"
    }
    return true
  }

  /** 恢复出厂：cache 只属于浮层投影，必须与其他 native floating state 一起清除。 */
  fun clearAllForFactoryReset(context: Context) {
    check(preferences(context).edit().clear().commit()) {
      "无法清空 RavenCat Together Listening projection cache"
    }
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  private fun JSONObject.requiredString(key: String): String {
    return optString(key, "").trim().ifEmpty {
      throw IllegalArgumentException("Together Listening projection 字段 $key 不能为空")
    }
  }

  private fun JSONObject.optionalString(key: String): String? {
    return optString(key, "").trim().takeIf { it.isNotEmpty() }
  }
}
