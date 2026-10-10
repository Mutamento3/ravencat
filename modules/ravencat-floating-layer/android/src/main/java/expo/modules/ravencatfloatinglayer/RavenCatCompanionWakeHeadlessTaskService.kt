package expo.modules.ravencatfloatinglayer

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class RavenCatCompanionWakeHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.fromBundle(extras),
      // Autonomous run 与 consume 共同决定任务终点，RN framework 不得提前结束宿主生命周期。
      0L,
      true,
    )
  }

  companion object {
    private const val TAG = "RavenCatCompanionWake"
    const val TASK_KEY = "RavenCatCompanionWakeTask"

    fun start(context: Context, event: RavenCatCompanionWakeEvent): Boolean {
      Log.i(TAG, "headless task start requested eventId=${event.eventId} reason=${event.wakeReason}")
      RavenCatCompanionWakeStore.recordHeadlessTaskStartRequested(context, event)

      val intent = Intent(context, RavenCatCompanionWakeHeadlessTaskService::class.java).apply {
        putExtras(event.toBundle())
      }

      return try {
        acquireWakeLockNow(context)
        context.startService(intent)
        RavenCatCompanionWakeStore.recordHeadlessTaskStartAccepted(context, event)
        Log.i(TAG, "headless task start accepted eventId=${event.eventId}")
        true
      } catch (error: RuntimeException) {
        val message = error.message ?: error.javaClass.simpleName
        Log.e(TAG, "Unable to start RavenCat companion Headless JS task", error)
        RavenCatCompanionWakeStore.recordHeadlessTaskStartFailed(context, event, message)
        RavenCatCompanionWakeStore.recordPending(context, event)
        false
      }
    }

    private fun RavenCatCompanionWakeEvent.toBundle(): Bundle {
      return Bundle().apply {
        putString("wakeReason", wakeReason)
        putString("source", source)
        putString("eventId", eventId)
        putDouble("createdAtEpochMs", createdAtEpochMs.toDouble())
        putDouble("scheduleRevision", scheduleRevision.toDouble())
        putString("hostAIId", hostAIId)
        triggerKind?.let { putString("triggerKind", it) }
        expectedRemindAtEpochMs?.let { putDouble("expectedRemindAtEpochMs", it.toDouble()) }
        projectionToken?.let { putString("projectionToken", it) }
        deliveryEventId?.let { putString("deliveryEventId", it) }
      }
    }
  }
}
