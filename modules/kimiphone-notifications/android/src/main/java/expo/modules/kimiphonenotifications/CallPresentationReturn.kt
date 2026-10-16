package expo.modules.kimiphonenotifications

import android.app.Activity

/** 只记录展示来源，不拥有通话状态或执行期；全部访问位于主线程。 */
internal object CallPresentationReturn {
  private val startedActivities = mutableSetOf<Activity>()
  private var externalCallId: String? = null

  val isAppVisible: Boolean get() = startedActivities.isNotEmpty()

  fun started(activity: Activity) { startedActivities.add(activity) }
  fun stopped(activity: Activity) { startedActivities.remove(activity) }

  fun accepted(callId: String, returnToPreviousApp: Boolean) {
    externalCallId = if (returnToPreviousApp) callId else null
  }

  fun leave(callId: String, finished: Boolean, activity: Activity?) {
    if (externalCallId != callId) return
    if (finished) externalCallId = null
    // 仅把本应用任务退后，由系统恢复之前的任务；不启动其他应用，也不结束 Headless。
    activity?.moveTaskToBack(true)
  }
}
