package expo.modules.androidoverlayruntime

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings

/** 提供系统悬浮权限检查与设置页跳转，不解释具体窗口用途。 */
object OverlayPermissionGateway {
  fun isGranted(context: Context): Boolean {
    return Settings.canDrawOverlays(context)
  }

  fun openSettings(activity: Activity) {
    val packageUri = Uri.parse("package:${activity.packageName}")
    val overlaySettingsIntent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri)
    val appDetailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri)

    try {
      activity.startActivity(overlaySettingsIntent)
    } catch (_: Exception) {
      activity.startActivity(appDetailsIntent)
    }
  }
}
