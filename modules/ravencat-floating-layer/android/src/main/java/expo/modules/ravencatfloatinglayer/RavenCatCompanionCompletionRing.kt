package expo.modules.ravencatfloatinglayer

/**
 * 已完成 delivery 的有界去重环（纯函数）。
 *
 * 环里保存的全部是 delivery identity（AI Schedule 为 `eventId@projectionToken`），不是
 * resolved `eventId`：系统可能用原 intent 重复投递同一次 delivery（START_REDELIVER_INTENT、
 * 进程重建等），JS 每次冷启动都要付完整初始化成本；已结案的 delivery 不允许再付第二次。
 * 只保留最近若干条完成记录，序列化为换行分隔字符串存进 SharedPreferences。
 */
internal object RavenCatCompanionCompletionRing {
  const val MAX_RECENT_COMPLETION_DELIVERY_IDS = 16
  private const val SEPARATOR = "\n"

  fun contains(serialized: String?, deliveryEventId: String): Boolean {
    if (serialized.isNullOrBlank() || deliveryEventId.isBlank()) return false
    return serialized.split(SEPARATOR).any { it == deliveryEventId }
  }

  fun append(serialized: String?, deliveryEventId: String): String {
    require(deliveryEventId.isNotBlank() && !deliveryEventId.contains(SEPARATOR)) {
      "deliveryEventId 非法"
    }
    val existing = serialized
      ?.split(SEPARATOR)
      ?.filter { it.isNotBlank() && it != deliveryEventId }
      .orEmpty()
    return (existing + deliveryEventId)
      .takeLast(MAX_RECENT_COMPLETION_DELIVERY_IDS)
      .joinToString(SEPARATOR)
  }
}
