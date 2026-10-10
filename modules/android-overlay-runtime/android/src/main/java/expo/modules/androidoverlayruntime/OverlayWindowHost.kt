package expo.modules.androidoverlayruntime

import android.content.Context
import android.view.View
import android.view.WindowManager

/** 集中执行系统悬浮 View 的添加、更新与移除。 */
class OverlayWindowHost(context: Context) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  fun add(view: View, layoutParams: WindowManager.LayoutParams) {
    windowManager.addView(view, layoutParams)
  }

  fun update(view: View, layoutParams: WindowManager.LayoutParams) {
    windowManager.updateViewLayout(view, layoutParams)
  }

  fun remove(view: View) {
    windowManager.removeView(view)
  }
}
