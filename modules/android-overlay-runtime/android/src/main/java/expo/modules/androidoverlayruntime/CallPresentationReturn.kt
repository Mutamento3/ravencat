package expo.modules.androidoverlayruntime

import android.app.Activity

/** 主界面可见性与本次展示来源的唯一记录，不拥有通话状态或执行期；全部访问位于主线程。 */
object CallPresentationReturn {
  private val startedActivities = mutableSetOf<Activity>()
  private val visibilityListeners = mutableSetOf<(Boolean) -> Unit>()
  private var externalCallId: String? = null

  val isAppVisible: Boolean get() = startedActivities.isNotEmpty()

  fun started(activity: Activity) { updateActivity(activity, true) }
  fun stopped(activity: Activity) { updateActivity(activity, false) }

  /** Started/Stopped 表达实际可见性；权限窗口导致的 Pause 不代表主界面已经隐藏。 */
  fun subscribeAppVisibility(listener: (Boolean) -> Unit): () -> Unit {
    visibilityListeners.add(listener)
    listener(isAppVisible)
    return { visibilityListeners.remove(listener) }
  }

  private fun updateActivity(activity: Activity, started: Boolean) {
    val previouslyVisible = isAppVisible
    if (started) startedActivities.add(activity) else startedActivities.remove(activity)
    val visible = isAppVisible
    if (previouslyVisible != visible) visibilityListeners.forEach { it(visible) }
  }

  fun entered(callId: String, returnToPreviousApp: Boolean) {
    externalCallId = if (returnToPreviousApp) callId else null
  }

  fun leave(callId: String, activity: Activity?) {
    if (externalCallId != callId) return
    // 来源属于一次展示，收起后再次进入必须重新捕获，不能沿用首次接听的位置。
    externalCallId = null
    // 仅把本应用任务退后，由系统恢复之前的任务；不启动其他应用，也不结束 Headless。
    activity?.moveTaskToBack(true)
  }
}
