package expo.modules.ravencatfloatinglayer.view

import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayIntent
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlaySnapshot
import expo.modules.ravencatfloatinglayer.model.RavenCatScreenshotState
import expo.modules.ravencatfloatinglayer.model.RavenCatStagedScreenshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** 验证用户点击发送的输入契约，不依赖视图的内部字段与布局位置。 */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class RavenCatScreenshotComposerTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private val screenshot = RavenCatStagedScreenshot("shot-1", "file:///cache/shot.png")

  @Test
  fun `空输入只有暂存截图时可以发送`() {
    val intents = mutableListOf<RavenCatOverlayIntent>()
    val view = RavenCatComposerView(context, intents::add)
    view.render(RavenCatOverlaySnapshot())
    findView(view, "发送 RavenCat 消息").performClick()
    assertTrue(intents.isEmpty())

    view.render(RavenCatOverlaySnapshot(stagedScreenshot = screenshot))
    findView(view, "发送 RavenCat 消息").performClick()
    assertEquals("", (intents.single() as RavenCatOverlayIntent.Send).text)
  }

  @Test
  fun `截图暂存后保留文字且可继续编辑后发送`() {
    val intents = mutableListOf<RavenCatOverlayIntent>()
    val view = RavenCatComposerView(context, intents::add)
    view.render(RavenCatOverlaySnapshot(draft = "原有文字"))
    view.render(RavenCatOverlaySnapshot(draft = "原有文字", stagedScreenshot = screenshot))
    val input = findView(view, "RavenCat 消息输入框") as EditText
    assertEquals("原有文字", input.text.toString())
    input.setText("补充后的消息")
    findView(view, "发送 RavenCat 消息").performClick()
    assertEquals("补充后的消息", (intents.last() as RavenCatOverlayIntent.Send).text)
  }

  @Test
  fun `截图过程中不能提前发送`() {
    val intents = mutableListOf<RavenCatOverlayIntent>()
    val view = RavenCatComposerView(context, intents::add)
    for (state in listOf(RavenCatScreenshotState.HIDING, RavenCatScreenshotState.CAPTURING)) {
      view.render(RavenCatOverlaySnapshot(
        draft = "稍后发送", screenshotState = state, stagedScreenshot = screenshot,
      ))
      findView(view, "发送 RavenCat 消息").performClick()
    }
    assertTrue(intents.isEmpty())
    view.render(RavenCatOverlaySnapshot(draft = "稍后发送", stagedScreenshot = screenshot))
    findView(view, "发送 RavenCat 消息").performClick()
    assertEquals("稍后发送", (intents.single() as RavenCatOverlayIntent.Send).text)
  }

  @Test
  fun `移除截图后空输入恢复为不可发送`() {
    val intents = mutableListOf<RavenCatOverlayIntent>()
    val view = RavenCatComposerView(context, intents::add)
    view.render(RavenCatOverlaySnapshot(stagedScreenshot = screenshot))
    view.render(RavenCatOverlaySnapshot())
    findView(view, "发送 RavenCat 消息").performClick()
    assertTrue(intents.isEmpty())
  }

  private fun findView(root: View, description: String): View {
    return checkNotNull(findViewOrNull(root, description)) { "找不到交互入口：$description" }
  }

  private fun findViewOrNull(root: View, description: String): View? {
    if (root.contentDescription == description) return root
    if (root is ViewGroup) {
      for (index in 0 until root.childCount) {
        val child = findViewOrNull(root.getChildAt(index), description)
        if (child != null) return child
      }
    }
    return null
  }
}
