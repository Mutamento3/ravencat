package expo.modules.ravencatfloatinglayer.controller

import android.app.Activity
import android.app.Application
import android.os.Bundle

/**
 * RavenCat 自有 Activity 的前后台追踪，作为 Host AppState bridge 之外的
 * native fail-safe：回调由主线程 native 直接派发，即使 JS 线程崩溃也能生效。
 *
 * 只负责计数与去抖，不触碰窗口；foreground 变化通过回调交给 Runtime 转成
 * overlay suppression reason。释放延迟到主循环末尾：App 内部 Activity 切换
 * （A pause → B resume）中 B 的 resume 会取消待释放，避免闪出 Bubble。
 */
internal class RavenCatAppForegroundActivityTracker(
  private val scheduler: RavenCatDelayScheduler,
  private val onForegroundChanged: (Boolean) -> Unit,
) {
  private var resumedActivities = 0
  private var foreground = false
  private var pendingRelease: RavenCatScheduledTask? = null

  val isForeground: Boolean
    get() = foreground

  fun onActivityResumed() {
    pendingRelease?.cancel()
    pendingRelease = null
    resumedActivities += 1
    if (!foreground) {
      foreground = true
      onForegroundChanged(true)
    }
  }

  fun onActivityPaused() {
    resumedActivities = (resumedActivities - 1).coerceAtLeast(0)
    if (resumedActivities > 0 || !foreground) return
    pendingRelease = scheduler.schedule(0L) {
      pendingRelease = null
      // resume 可能已经在主循环同一批次里把计数拉回去；释放前再确认一次。
      if (resumedActivities == 0 && foreground) {
        foreground = false
        onForegroundChanged(false)
      }
    }
  }
}

/** 只把 Activity resume/pause 转发给 tracker；其余生命周期事件不影响 overlay 可见性。 */
internal class RavenCatAppForegroundObserver(
  private val tracker: RavenCatAppForegroundActivityTracker,
) : Application.ActivityLifecycleCallbacks {
  override fun onActivityResumed(activity: Activity) = tracker.onActivityResumed()
  override fun onActivityPaused(activity: Activity) = tracker.onActivityPaused()
  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
  override fun onActivityStarted(activity: Activity) = Unit
  override fun onActivityStopped(activity: Activity) = Unit
  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
  override fun onActivityDestroyed(activity: Activity) = Unit
}
