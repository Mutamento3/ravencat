package expo.modules.androidoverlayruntime

import android.content.Context
import android.graphics.Insets
import android.graphics.Rect
import android.view.WindowInsets
import android.view.WindowManager
import kotlin.math.max

/** 按当前窗口指标裁掉 system bars、挖孔与可见输入法区域。 */
class OverlayBoundsResolver(context: Context) {
  private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as WindowManager

  fun resolveAvailableBounds(): Rect {
    val metrics = windowManager.currentWindowMetrics
    return resolveAvailableBounds(metrics.bounds, metrics.windowInsets)
  }

  /** 不裁任何系统区域的完整屏幕边界，用于需要延伸到状态栏/挖孔区域的悬浮窗。 */
  fun resolveScreenBounds(): Rect {
    return windowManager.currentWindowMetrics.bounds
  }

  fun resolveAvailableBounds(windowInsets: WindowInsets): Rect {
    return resolveAvailableBounds(windowManager.currentWindowMetrics.bounds, windowInsets)
  }

  private fun resolveAvailableBounds(bounds: Rect, windowInsets: WindowInsets): Rect {
    val stableInsets = windowInsets.getInsetsIgnoringVisibility(
      WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
    )
    val imeInsets = windowInsets.getInsets(WindowInsets.Type.ime())
    val occupiedInsets = Insets.of(
      max(stableInsets.left, imeInsets.left),
      max(stableInsets.top, imeInsets.top),
      max(stableInsets.right, imeInsets.right),
      max(stableInsets.bottom, imeInsets.bottom),
    )
    val left = bounds.left + occupiedInsets.left
    val top = bounds.top + occupiedInsets.top
    val right = max(left, bounds.right - occupiedInsets.right)
    val bottom = max(top, bounds.bottom - occupiedInsets.bottom)
    return Rect(left, top, right, bottom)
  }
}
