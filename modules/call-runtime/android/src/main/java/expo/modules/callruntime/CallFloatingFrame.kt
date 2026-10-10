package expo.modules.callruntime

import android.content.Context
import android.os.SystemClock
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.FrameLayout

/** 整块窗口拥有触摸：越过系统移动阈值即拖动，只有完整双击才返回通话。 */
internal class CallFloatingFrame(
  context: Context,
  private val onDragStart: () -> Unit,
  private val onDragMove: (Float, Float) -> Unit,
  private val onDoubleTap: () -> Unit,
) : FrameLayout(context) {
  private var dragging = false
  private var downX = 0f
  private var downY = 0f
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val detector = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
    override fun onDown(event: MotionEvent) = true

    override fun onDoubleTapEvent(event: MotionEvent): Boolean {
      if (event.actionMasked == MotionEvent.ACTION_UP) onDoubleTap()
      return true
    }
  }).apply { setIsLongpressEnabled(false) }

  override fun dispatchTouchEvent(event: MotionEvent): Boolean {
    if (event.actionMasked == MotionEvent.ACTION_DOWN) {
      dragging = false
      downX = event.rawX; downY = event.rawY
    }
    val dx = event.rawX - downX
    val dy = event.rawY - downY
    if (!dragging && event.actionMasked == MotionEvent.ACTION_MOVE && dx * dx + dy * dy > touchSlop * touchSlop) {
      dragging = true
      onDragStart()
      // 第二下触碰也可能变成拖动；此时必须取消待识别双击，不能同时打开 App。
      val cancel = MotionEvent.obtain(event).apply { action = MotionEvent.ACTION_CANCEL }
      detector.onTouchEvent(cancel)
      cancel.recycle()
    }
    if (dragging) {
      if (event.actionMasked == MotionEvent.ACTION_MOVE) onDragMove(dx, dy)
    } else {
      detector.onTouchEvent(event)
    }
    return true
  }

  override fun onDetachedFromWindow() {
    val now = SystemClock.uptimeMillis()
    val cancel = MotionEvent.obtain(now, now, MotionEvent.ACTION_CANCEL, 0f, 0f, 0)
    detector.onTouchEvent(cancel)
    cancel.recycle()
    super.onDetachedFromWindow()
  }
}
