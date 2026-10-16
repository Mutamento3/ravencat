package expo.modules.kimiphonenotifications

import android.app.Activity
import android.app.Application
import android.content.Context
import android.os.Bundle
import com.facebook.react.ReactActivity
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** 在 JS 冷启动之前观察主界面；原生来电壳自身不能把“App 外接听”改判为前台。 */
class KimiPhoneNotificationsPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        application.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
          override fun onActivityStarted(activity: Activity) {
            if (activity is ReactActivity) CallPresentationReturn.started(activity)
          }
          override fun onActivityStopped(activity: Activity) { CallPresentationReturn.stopped(activity) }
          override fun onActivityDestroyed(activity: Activity) { CallPresentationReturn.stopped(activity) }
          override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
          override fun onActivityResumed(activity: Activity) {}
          override fun onActivityPaused(activity: Activity) {}
          override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
        })
      }
    })
}
