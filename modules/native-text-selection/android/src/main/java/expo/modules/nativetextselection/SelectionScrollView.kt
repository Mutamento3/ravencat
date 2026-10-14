package expo.modules.nativetextselection

import android.view.View
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.views.scroll.ReactScrollView
import com.facebook.react.views.scroll.ReactScrollViewManager

/** 继续使用 RN 的滚动、事件、命令与锚点，只隔离触摸文字选择引起的焦点滚动。 */
internal class SelectionScrollView(context: ThemedReactContext) : ReactScrollView(context) {
  private val focusScroll = TextSelectionFocusScrollPolicy()

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
