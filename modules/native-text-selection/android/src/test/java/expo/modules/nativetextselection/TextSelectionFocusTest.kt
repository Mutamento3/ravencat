@file:Suppress("DEPRECATION")

package expo.modules.nativetextselection

import android.app.Activity
import android.content.Context
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags
import com.facebook.react.uimanager.ThemedReactContext
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** 验证只读选择的焦点生命周期，编辑输入与正常滚动不参与隔离。 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class TextSelectionFocusTest {
  private class SelectableText(context: Context) : TextView(context) {
    var touchMode = true
    override fun isInTouchMode() = touchMode
  }

  @Test fun `selection focus does not navigate to composer when body is removed`() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val root = FrameLayout(activity)
    val text = SelectableText(activity).apply { setTextIsSelectable(true); setText("思维链") }
    val composer = EditText(activity)
    root.addView(text)
    root.addView(composer)
    activity.setContentView(root)
    root.measure(View.MeasureSpec.makeMeasureSpec(480, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY))
    root.layout(0, 0, 480, 800)
    text.layout(0, 0, 480, 600)
    composer.layout(0, 600, 480, 800)
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(text.requestFocus())
    assertSame(text, root.findFocus())
    assertTrue(text.isReadOnlyTextSelection())
    val previous = root.rootView.let { (it as ViewGroup).descendantFocusability }
    releaseTextSelectionFocus(root.findFocus())
    root.removeView(text)
    assertFalse(composer.hasFocus())
    assertFalse(text.hasFocus())
    assertEquals(previous, (root.rootView as ViewGroup).descendantFocusability)
    composer.requestFocus()
    releaseTextSelectionFocus(composer)
    assertTrue(composer.hasFocus())
    controller.pause().stop().destroy()
  }

  @Test fun `only touch selection focus blocks focus scrolling`() {
    val controller = Robolectric.buildActivity(Activity::class.java).setup()
    val activity = controller.get()
    val text = SelectableText(activity).apply { setTextIsSelectable(true) }
    val policy = TextSelectionFocusScrollPolicy()
    repeat(3) {
      policy.requestChildFocus(text) { assertTrue(policy.blocksScroll) }
      assertFalse(policy.blocksScroll)
    }
    text.touchMode = false
    policy.requestChildFocus(text) { assertFalse(policy.blocksScroll) }
    policy.requestChildFocus(EditText(activity)) { assertFalse(policy.blocksScroll) }
    controller.pause().stop().destroy()
  }

  @Test fun `RN scroll view preserves reading offset on selection focus and still accepts scrolling`() {
    // RN 提供的 JVM flags accessor 避免单元测试依赖 C++ JNI，滚动视图仍使用真实实现。
    val accessorType = Class.forName("com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsLocalAccessor")
    val setAccessor = ReactNativeFeatureFlags.javaClass.declaredMethods.single { it.name.startsWith("setAccessorProvider") }
    setAccessor.invoke(ReactNativeFeatureFlags, { accessorType.getDeclaredConstructor().newInstance() })
    val controller = Robolectric.buildActivity(Activity::class.java).setup().visible()
    val activity = controller.get()
    val context = ThemedReactContext(BridgeReactContext(activity.application), activity, "selection-test", 1)
    val scroll = SelectionScrollView(context)
    val content = FrameLayout(activity)
    val text = SelectableText(activity).apply { setTextIsSelectable(true) }
    content.addView(text)
    scroll.addView(content)
    activity.setContentView(scroll)
    scroll.layout(0, 0, 480, 600)
    content.layout(0, 0, 480, 5000)
    text.layout(0, 2380, 480, 4800)
    scroll.scrollTo(0, 1800)
    scroll.requestChildFocus(content, text)
    assertEquals(1800, scroll.scrollY)
    scroll.scrollTo(0, 2200)
    assertEquals(2200, scroll.scrollY)
    text.touchMode = false
    scroll.requestChildFocus(content, text)
    assertNotEquals(2200, scroll.scrollY)
    controller.pause().stop().destroy()
  }
}
