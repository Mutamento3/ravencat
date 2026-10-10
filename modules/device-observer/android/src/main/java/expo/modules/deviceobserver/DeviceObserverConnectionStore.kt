package expo.modules.deviceobserver

import android.content.Context

/** 持久化最近连接和窗口事件诊断，避免把业务状态塞入原生层。 */
internal object DeviceObserverConnectionStore {
  private const val PREFERENCES_NAME = "device_observer_connection"
  private const val KEY_CONNECTED_AT_EPOCH_MS = "connected_at_epoch_ms"
  private const val KEY_DISCONNECTED_AT_EPOCH_MS = "disconnected_at_epoch_ms"
  private const val KEY_LAST_EVENT_AT_EPOCH_MS = "last_event_at_epoch_ms"
  private const val KEY_PACKAGE_NAME = "package_name"
  private const val KEY_WINDOW_ID = "window_id"
  private const val KEY_WINDOW_TITLE = "window_title"
  private const val KEY_DETECTION_RELIABLE = "detection_reliable"
  private const val KEY_WINDOW_CHECKED_AT_EPOCH_MS = "window_checked_at_epoch_ms"
  private const val KEY_WINDOW_SOURCE = "window_source"
  private const val UNKNOWN_WINDOW_ID = Int.MIN_VALUE

  fun recordConnected(context: Context, connectedAtEpochMs: Long) {
    preferences(context)
      .edit()
      .putLong(KEY_CONNECTED_AT_EPOCH_MS, connectedAtEpochMs)
      .apply()
  }

  fun recordDisconnected(context: Context, disconnectedAtEpochMs: Long) {
    preferences(context)
      .edit()
      .putLong(KEY_DISCONNECTED_AT_EPOCH_MS, disconnectedAtEpochMs)
      .apply()
  }

  fun recordWindowState(context: Context, state: DeviceWindowState) {
    preferences(context)
      .edit()
      .putLong(KEY_LAST_EVENT_AT_EPOCH_MS, state.checkedAtEpochMs)
      .putString(KEY_PACKAGE_NAME, state.packageName)
      .putInt(KEY_WINDOW_ID, state.windowId ?: UNKNOWN_WINDOW_ID)
      .putString(KEY_WINDOW_TITLE, state.title)
      .putBoolean(KEY_DETECTION_RELIABLE, state.detectionReliable)
      .putLong(KEY_WINDOW_CHECKED_AT_EPOCH_MS, state.checkedAtEpochMs)
      .putString(KEY_WINDOW_SOURCE, state.source)
      .apply()
  }

  fun readConnectedAtEpochMs(context: Context): Long {
    return preferences(context).getLong(KEY_CONNECTED_AT_EPOCH_MS, 0L)
  }

  fun readDisconnectedAtEpochMs(context: Context): Long {
    return preferences(context).getLong(KEY_DISCONNECTED_AT_EPOCH_MS, 0L)
  }

  fun readLastEventAtEpochMs(context: Context): Long {
    return preferences(context).getLong(KEY_LAST_EVENT_AT_EPOCH_MS, 0L)
  }

  fun readWindowState(context: Context): DeviceWindowState {
    val values = preferences(context)
    val checkedAtEpochMs = values.getLong(KEY_WINDOW_CHECKED_AT_EPOCH_MS, 0L)
    if (checkedAtEpochMs == 0L) {
      return DeviceWindowState.unknown()
    }

    val storedWindowId = values.getInt(KEY_WINDOW_ID, UNKNOWN_WINDOW_ID)
    return DeviceWindowState(
      packageName = values.getString(KEY_PACKAGE_NAME, null),
      windowId = storedWindowId.takeUnless { it == UNKNOWN_WINDOW_ID },
      title = values.getString(KEY_WINDOW_TITLE, null),
      detectionReliable = values.getBoolean(KEY_DETECTION_RELIABLE, false),
      checkedAtEpochMs = checkedAtEpochMs,
      source = values.getString(KEY_WINDOW_SOURCE, null) ?: "unknown",
    )
  }

  /** 恢复出厂：清空诊断与最近窗口信息，不关闭无障碍权限。 */
  fun clearAllForFactoryReset(context: Context) {
    check(preferences(context).edit().clear().commit()) {
      "无法清空 Device Observer 状态"
    }
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)
}
