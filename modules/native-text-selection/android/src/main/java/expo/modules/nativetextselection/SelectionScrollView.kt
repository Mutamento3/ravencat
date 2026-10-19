package expo.modules.nativetextselection

import android.view.View
import android.view.ViewGroup
import android.view.MotionEvent
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager
import com.facebook.react.views.scroll.ReactScrollViewHelper
import com.facebook.react.views.scroll.ScrollEventType

/** 保留 RN 滚动与锚点，隔离选区焦点滚动，并配对被触摸中断的惯性事件。 */
internal class SelectionScrollView(context: ThemedReactContext) : ReactScrollView(context), ReactScrollViewHelper.ScrollListener {
  private val focusScroll = TextSelectionFocusScrollPolicy()
  private var momentumActive = false

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    ReactScrollViewHelper.addScrollListener(this)
  }

  override fun onDetachedFromWindow() {
    ReactScrollViewHelper.removeScrollListener(this)
    super.onDetachedFromWindow()
  }

  override fun onScroll(scrollView: ViewGroup?, scrollEventType: ScrollEventType?, xVelocity: Float, yVelocity: Float) {
    if (scrollView !== this) return
    when (scrollEventType) {
      ScrollEventType.MOMENTUM_BEGIN -> momentumActive = true
      ScrollEventType.MOMENTUM_END -> momentumActive = false
      else -> Unit
    }
  }

  override fun onLayout(scrollView: ViewGroup?) = Unit

  override fun onTouchEvent(event: MotionEvent): Boolean {
    val handled = super.onTouchEvent(event)
    // RN 0.81 的 ACTION_DOWN 会取消惯性结束 runnable，却没有发送结束事件。
    // 原生已停止后必须配对结束，否则 JS ScrollView 会一直截走子控件的点击。
    if (handled && event.actionMasked == MotionEvent.ACTION_DOWN && momentumActive) {
      ReactScrollViewHelper.emitScrollMomentumEndEvent(this)
    }
    return handled
  }

  override fun requestChildFocus(child: View, focused: View) {
    focusScroll.requestChildFocus(focused) { super.requestChildFocus(child, focused) }
  }

  override fun scrollTo(x: Int, y: Int) {
    if (!focusScroll.blocksScroll) super.scrollTo(x, y)
  }
}

internal class SelectionScrollViewManager : ReactScrollViewManager() {
  override fun getName() = "NativeTextSelectionScrollView"
  override fun createViewInstance(context: ThemedReactContext): ReactScrollView = SelectionScrollView(context)
}
