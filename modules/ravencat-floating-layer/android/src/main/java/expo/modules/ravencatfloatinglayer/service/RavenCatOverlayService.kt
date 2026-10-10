package expo.modules.ravencatfloatinglayer.service

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import expo.modules.ravencatfloatinglayer.runtime.RavenCatOverlayRuntime

/** 只负责 RavenCat 前台 Overlay Service 生命周期与通知。 */
class RavenCatOverlayService : Service() {
  override fun onCreate() {
    super.onCreate()
    isRunning = true
    isForegroundRunning = false
    RavenCatOverlayRuntime.attach(this)
    Log.i(TAG, "RavenCatOverlayService.onCreate")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    RavenCatOverlayRuntime.showBubble()
    ServiceCompat.startForeground(
      this,
      RavenCatOverlayNotification.NOTIFICATION_ID,
      RavenCatOverlayNotification.build(this),
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE,
    )
    isForegroundRunning = true
    return START_STICKY
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    // Service 实例不随配置变化重建，onConfigurationChanged 在横竖屏切换等场景由系统调用。
    // 转发给 Runtime 重新约束常驻悬浮球/面板的位置与几何，避免停在旧坐标越界或贴错边。
    RavenCatOverlayRuntime.handleConfigurationChanged()
  }

  override fun onDestroy() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    RavenCatOverlayRuntime.detach()
    isRunning = false
    isForegroundRunning = false
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    @Volatile
    var isRunning: Boolean = false
      private set

    @Volatile
    var isForegroundRunning: Boolean = false
      private set

    private const val TAG = "RavenCatOverlayService"
  }
}
