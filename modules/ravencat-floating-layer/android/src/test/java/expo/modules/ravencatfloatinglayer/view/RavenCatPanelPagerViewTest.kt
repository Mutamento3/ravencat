package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.view.MotionEvent
import android.view.View
import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * View 级手势测试：构造真实 DOWN→MOVE→UP 事件流走完整 dispatchTouchEvent 分发。
 * 覆盖 Together 无点击 child、Chat 顶部边界接力，以及可滚动/交互区不被 pager 抢手势。
 */
// Robolectric 4.14 最高支持 SDK 35，工程 targetSdk=36，需显式钉住 SDK。
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class RavenCatPanelPagerViewTest {

  private lateinit var context: Context

  @Before
  fun setUp() {
    context = RuntimeEnvironment.getApplication()
    // 固定 density=1：48dp 阈值即 48px，位移直接用像素表达。
    context.resources.displayMetrics.density = 1f
  }

  /** 消费 DOWN 并记录全部事件，模拟 ScrollView / composer 等可交互 child。 */
  private class TouchRecordingView(context: Context) : View(context) {
    val actions = mutableListOf<Int>()

    override fun onTouchEvent(event: MotionEvent): Boolean {
      actions.add(event.actionMasked)
      return true
    }
  }

  private class Harness(
    val pager: RavenCatPanelPagerView,
    val pageChanges: List<RavenCatPanelPage>,
  )

  private fun createPager(
    chatPage: View = View(context),
    canStartChatPageSwipe: () -> Boolean = { true },
  ): Harness {
    val changes = mutableListOf<RavenCatPanelPage>()
    // Together 页默认用不可点击的普通 View，复现 ImageView/Chronometer 不消费 DOWN 的场景。
    val pager = RavenCatPanelPagerView(
      context = context,
      chatPage = chatPage,
      togetherPage = View(context),
      canStartChatPageSwipe = { _, _ -> canStartChatPageSwipe() },
      onPageChanged = { changes.add(it) },
    )
    pager.measure(
      View.MeasureSpec.makeMeasureSpec(WIDTH_PX, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(HEIGHT_PX, View.MeasureSpec.EXACTLY),
    )
    pager.layout(0, 0, WIDTH_PX, HEIGHT_PX)
    return Harness(pager, changes)
  }

  private fun gesture(pager: RavenCatPanelPagerView, points: List<Pair<Float, Float>>) {
    val downTime = 1000L
    points.forEachIndexed { index, (x, y) ->
      val action = when (index) {
        0 -> MotionEvent.ACTION_DOWN
        points.lastIndex -> MotionEvent.ACTION_UP
        else -> MotionEvent.ACTION_MOVE
      }
      val event = MotionEvent.obtain(downTime, downTime + index * 10L, action, x, y, 0)
      pager.dispatchTouchEvent(event)
      event.recycle()
    }
  }

  @Test
  fun `TOGETHER 页 child 不可点击时上滑超过阈值切到 CHAT`() {
    val harness = createPager()
    harness.pager.setTogetherPageAvailable(true)
    harness.pager.showPage(RavenCatPanelPage.TOGETHER, notify = false)

    gesture(harness.pager, listOf(200f to 400f, 200f to 340f, 200f to 340f))

    assertEquals(RavenCatPanelPage.CHAT, harness.pager.currentPage())
    assertEquals(listOf(RavenCatPanelPage.CHAT), harness.pageChanges)
  }

  @Test
  fun `CHAT 页顶部允许接力时下拉超过阈值切到 TOGETHER`() {
    val harness = createPager(canStartChatPageSwipe = { true })
    harness.pager.setTogetherPageAvailable(true)

    gesture(harness.pager, listOf(200f to 400f, 200f to 460f, 200f to 460f))

    assertEquals(RavenCatPanelPage.TOGETHER, harness.pager.currentPage())
    assertEquals(listOf(RavenCatPanelPage.TOGETHER), harness.pageChanges)
  }

  @Test
  fun `CHAT 页仍可向上回滚时下拉不切页`() {
    val recording = TouchRecordingView(context)
    val harness = createPager(recording, canStartChatPageSwipe = { false })
    harness.pager.setTogetherPageAvailable(true)

    gesture(harness.pager, listOf(200f to 400f, 200f to 460f, 200f to 460f))

    assertEquals(RavenCatPanelPage.CHAT, harness.pager.currentPage())
    assertTrue(harness.pageChanges.isEmpty())
    assertTrue(recording.actions.contains(MotionEvent.ACTION_UP))
    assertFalse(recording.actions.contains(MotionEvent.ACTION_CANCEL))
  }

  @Test
  fun `横向占优的滑动不切页`() {
    val harness = createPager()
    harness.pager.setTogetherPageAvailable(true)
    harness.pager.showPage(RavenCatPanelPage.TOGETHER, notify = false)

    gesture(harness.pager, listOf(200f to 400f, 270f to 350f, 270f to 350f))

    assertEquals(RavenCatPanelPage.TOGETHER, harness.pager.currentPage())
    assertTrue(harness.pageChanges.isEmpty())
  }

  @Test
  fun `纵向位移未过阈值不切页`() {
    val harness = createPager()
    harness.pager.setTogetherPageAvailable(true)
    harness.pager.showPage(RavenCatPanelPage.TOGETHER, notify = false)

    gesture(harness.pager, listOf(200f to 400f, 200f to 360f, 200f to 360f))

    assertEquals(RavenCatPanelPage.TOGETHER, harness.pager.currentPage())
    assertTrue(harness.pageChanges.isEmpty())
  }

  @Test
  fun `Together 不可用时下拉不切页`() {
    val harness = createPager()

    gesture(harness.pager, listOf(200f to 400f, 200f to 460f, 200f to 460f))

    assertEquals(RavenCatPanelPage.CHAT, harness.pager.currentPage())
    assertTrue(harness.pageChanges.isEmpty())
  }

  @Test
  fun `一次手势 MOVE 多次超过阈值只切一页`() {
    val harness = createPager()
    harness.pager.setTogetherPageAvailable(true)
    harness.pager.showPage(RavenCatPanelPage.TOGETHER, notify = false)

    gesture(
      harness.pager,
      listOf(200f to 400f, 200f to 340f, 200f to 470f, 200f to 470f),
    )

    assertEquals(RavenCatPanelPage.CHAT, harness.pager.currentPage())
    assertEquals(listOf(RavenCatPanelPage.CHAT), harness.pageChanges)
  }

  @Test
  fun `CHAT 页顶部下拉被 pager 接管且 child 收到 CANCEL`() {
    val recording = TouchRecordingView(context)
    val harness = createPager(recording, canStartChatPageSwipe = { true })
    harness.pager.setTogetherPageAvailable(true)

    gesture(harness.pager, listOf(200f to 400f, 200f to 460f, 200f to 460f))

    assertEquals(RavenCatPanelPage.TOGETHER, harness.pager.currentPage())
    assertTrue(recording.actions.contains(MotionEvent.ACTION_DOWN))
    assertTrue(recording.actions.contains(MotionEvent.ACTION_CANCEL))
  }

  private companion object {
    const val WIDTH_PX = 400
    const val HEIGHT_PX = 800
  }
}
