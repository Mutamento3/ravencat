package expo.modules.androidoverlayruntime

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri

/** 为确定性的应用内 deep link 创建悬浮入口启动意图。 */
object OverlayLaunchIntentFactory {
  fun createIntent(context: Context, target: Uri): Intent {
    return Intent(Intent.ACTION_VIEW, target).apply {
      setPackage(context.packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
  }

  fun createPendingIntent(
    context: Context,
    target: Uri,
    requestCode: Int = target.toString().hashCode(),
  ): PendingIntent {
    return PendingIntent.getActivity(
      context,
      requestCode,
      createIntent(context, target),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }
}
