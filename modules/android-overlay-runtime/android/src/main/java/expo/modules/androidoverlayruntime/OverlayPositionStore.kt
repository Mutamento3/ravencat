package expo.modules.androidoverlayruntime

import android.content.Context

data class OverlayPosition(val x: Int, val y: Int)

/** 按调用方提供的窗口类型键保存位置，不持久化业务状态。 */
class OverlayPositionStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun load(positionKey: String): OverlayPosition? {
    if (!preferences.contains(xKey(positionKey)) || !preferences.contains(yKey(positionKey))) {
      return null
    }
    return OverlayPosition(
      x = preferences.getInt(xKey(positionKey), 0),
      y = preferences.getInt(yKey(positionKey), 0),
    )
  }

  fun save(positionKey: String, position: OverlayPosition) {
    preferences.edit()
      .putInt(xKey(positionKey), position.x)
      .putInt(yKey(positionKey), position.y)
      .apply()
  }

  /** 恢复出厂：清空全部悬浮窗位置。 */
  fun clearAllForFactoryReset() {
    check(preferences.edit().clear().commit()) {
      "无法清空悬浮窗位置"
    }
  }

  private fun xKey(positionKey: String): String = "$positionKey.x"

  private fun yKey(positionKey: String): String = "$positionKey.y"

  companion object {
    private const val PREFERENCES_NAME = "android_overlay_positions"
  }
}
