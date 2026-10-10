package expo.modules.deviceobserver

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import android.os.UserManager

/** 系统聚合统计可能覆盖完整 bucket，保留其真实边界，不能声称是精确切片。 */
class AppUsageQuery(private val context: Context) {
  fun isAccessGranted(): Boolean {
    val appOps = context.getSystemService(AppOpsManager::class.java)
    return appOps.checkOpNoThrow(
      AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName,
    ) == AppOpsManager.MODE_ALLOWED
  }

  fun query(beginTime: Long, endTime: Long): Map<String, Any?> {
    require(beginTime >= 0 && endTime > beginTime) { "应用使用时长查询时间范围无效" }
    if (!isAccessGranted()) return mapOf("status" to "permission_not_granted")
    if (!context.getSystemService(UserManager::class.java).isUserUnlocked) {
      return mapOf("status" to "device_locked")
    }
    val manager = context.getSystemService(UsageStatsManager::class.java)
    val stats = manager.queryAndAggregateUsageStats(beginTime, endTime)
    return mapOf(
      "status" to "available",
      "requestedStartEpochMs" to beginTime,
      "requestedEndEpochMs" to endTime,
      "apps" to stats.values.filter { it.totalTimeInForeground > 0 }.map {
        mapOf(
          "packageName" to it.packageName,
          "foregroundTimeMs" to it.totalTimeInForeground,
          "firstTimestampEpochMs" to it.firstTimeStamp,
          "lastTimestampEpochMs" to it.lastTimeStamp,
          "lastTimeUsedEpochMs" to it.lastTimeUsed,
        )
      },
    )
  }
}
