package expo.modules.ravencatfloatinglayer

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import java.util.concurrent.Executors

/** 保留 idle 下的系统唤醒能力；每条日程只有一个 Alarm identity，仍交给同一 Worker gate。 */
internal object RavenCatAIScheduleAlarmScheduler {
  fun schedule(context: Context, projection: RavenCatAIScheduleProjection) {
    val pending = PendingIntent.getBroadcast(
      context, 0, alarmIntent(context, projection.scheduleId).apply {
        putExtra("expectedRemindAtEpochMs", projection.expectedRemindAtEpochMs)
        putExtra("projectionToken", projection.projectionToken)
      }, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    alarmManager(context).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, projection.expectedRemindAtEpochMs, pending)
  }

  fun cancel(context: Context, scheduleId: String) {
    val pending = PendingIntent.getBroadcast(
      context, 0, alarmIntent(context, scheduleId),
      PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE,
    ) ?: return
    alarmManager(context).cancel(pending)
    pending.cancel()
  }

  private fun alarmIntent(context: Context, scheduleId: String) =
    Intent(context, RavenCatAIScheduleAlarmReceiver::class.java)
      .setAction("expo.modules.ravencatfloatinglayer.action.AI_SCHEDULE_ALARM")
      .setData(Uri.Builder().scheme("ravencat-schedule").authority("alarm").appendPath(scheduleId).build())
      .putExtra("scheduleId", scheduleId)

  private fun alarmManager(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
}

/** 原生输入校验后只投递同一日程的立即 Work；不启动第二个执行宿主或业务任务。 */
class RavenCatAIScheduleAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val scheduleId = intent.getStringExtra("scheduleId")?.takeIf { it.isNotBlank() } ?: return
    val token = intent.getStringExtra("projectionToken")?.takeIf { it.isNotBlank() } ?: return
    val expectedAt = intent.getLongExtra("expectedRemindAtEpochMs", 0L)
    if (expectedAt <= 0L) return
    val pending = goAsync()
    EXECUTOR.execute {
      try {
        RavenCatAIScheduleScheduler.enqueueFromAlarm(context.applicationContext, scheduleId, expectedAt, token)
      } catch (error: Exception) {
        Log.e("RavenCatAISchedule", "日程 Alarm 投递失败", error)
      } finally {
        pending.finish()
      }
    }
  }

  private companion object {
    val EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "RavenCatScheduleAlarm").apply { isDaemon = true }
    }
  }
}

/** 重启／更新后只恢复未来 Alarm，不为错过的日程补造执行机会。 */
class RavenCatAIScheduleBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    RavenCatAIScheduleScheduler.restoreFutureAlarms(context)
  }
}
