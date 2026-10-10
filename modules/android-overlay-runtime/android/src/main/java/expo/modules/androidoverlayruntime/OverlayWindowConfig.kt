package expo.modules.androidoverlayruntime

import android.graphics.PixelFormat
import android.view.Gravity
import android.view.WindowManager

/** 描述一个没有业务含义的系统悬浮窗口。 */
data class OverlayWindowConfig(
  val width: Int,
  val height: Int,
  val flags: Int,
  val x: Int = 0,
  val y: Int = 0,
  val gravity: Int = Gravity.TOP or Gravity.START,
  val type: Int = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
  val format: Int = PixelFormat.TRANSLUCENT,
  val softInputMode: Int = 0,
) {
  fun toLayoutParams(): WindowManager.LayoutParams {
    return WindowManager.LayoutParams(
      width,
      height,
      type,
      flags,
      format,
    ).apply {
      gravity = this@OverlayWindowConfig.gravity
      x = this@OverlayWindowConfig.x
      y = this@OverlayWindowConfig.y
      softInputMode = this@OverlayWindowConfig.softInputMode
    }
  }
}
