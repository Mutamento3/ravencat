package expo.modules.deviceobserver

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager

/** 按需读取系统电池快照，与无障碍连接及观察服务生命周期无关。 */
class DeviceBatteryQuery(private val context: Context) {
  fun read(): Map<String, Any?> {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      ?: return mapOf("status" to "unavailable")
    val level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (scale <= 0 || level < 0 || level > scale) return mapOf("status" to "unavailable")
    val state = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    val chargingState = when {
      state == BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
      state == BatteryManager.BATTERY_STATUS_FULL && plugged -> "full"
      state == BatteryManager.BATTERY_STATUS_DISCHARGING ||
        state == BatteryManager.BATTERY_STATUS_NOT_CHARGING ||
        state == BatteryManager.BATTERY_STATUS_FULL -> "not_charging"
      else -> "unknown"
    }
    return mapOf(
      "status" to "available",
      "levelPercent" to Math.round(level * 100.0 / scale).toInt(),
      "chargingState" to chargingState,
    )
  }
}
