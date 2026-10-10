package expo.modules.ravencatfloatinglayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager

/** 一次性撤掉旧 Self Wake 的原生执行镜像；SQLite 计划迁移由 persistence 完成。 */
internal fun retireLegacySelfWakeProjection(context: Context) {
  val prefs = context.getSharedPreferences("ravencat_ai_schedule_scheduler", Context.MODE_PRIVATE)
  if (prefs.getBoolean("selfWakeRetired", false)) return
  val intent = Intent().setComponent(ComponentName(
    context.packageName, "expo.modules.ravencatfloatinglayer.RavenCatCompanionAlarmReceiver",
  )).setAction("expo.modules.ravencatfloatinglayer.action.SELF_WAKE_ALARM")
  val pending = PendingIntent.getBroadcast(context, 41021, intent,
    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
  if (pending != null) {
    (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(pending)
    pending.cancel()
  }
  WorkManager.getInstance(context).cancelUniqueWork("ravencat_companion_single_wake").result.get()
  check(context.getSharedPreferences("ravencat_companion_wake_scheduler", Context.MODE_PRIVATE)
    .edit().clear().commit()) { "旧 Self Wake 镜像清理失败" }
  check(prefs.edit().putBoolean("selfWakeRetired", true).commit()) { "日程迁移标记提交失败" }
}
