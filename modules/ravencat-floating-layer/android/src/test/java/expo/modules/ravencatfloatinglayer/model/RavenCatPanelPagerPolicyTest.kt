package expo.modules.ravencatfloatinglayer.model

import expo.modules.ravencatfloatinglayer.controller.RavenCatOverlayWindowState
import expo.modules.ravencatfloatinglayer.controller.RavenCatTogetherPanelTransitionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatPanelPagerPolicyTest {
  @Test
  fun `bubble tap opens chat page without together and together page when active`() {
    assertEquals(RavenCatPanelPage.CHAT, RavenCatPanelPagerPolicy.initialPage(togetherActive = false))
    assertEquals(RavenCatPanelPage.TOGETHER, RavenCatPanelPagerPolicy.initialPage(togetherActive = true))
  }

  @Test
  fun `together page only exists while together active`() {
    assertEquals(
      listOf(RavenCatPanelPage.CHAT),
      RavenCatPanelPagerPolicy.availablePages(togetherActive = false),
    )
    // 视觉顺序：CHAT 在上，TOGETHER 在下。
    assertEquals(
      listOf(RavenCatPanelPage.CHAT, RavenCatPanelPage.TOGETHER),
      RavenCatPanelPagerPolicy.availablePages(togetherActive = true),
    )
  }

  @Test
  fun `swipe below threshold or horizontal dominant never switches page`() {
    val threshold = 100f
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.TOGETHER, true, deltaX = 0f, deltaY = -40f, threshold,
      ),
    )
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.TOGETHER, true, deltaX = 130f, deltaY = -120f, threshold,
      ),
    )
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.TOGETHER, true, deltaX = 120f, deltaY = -120f, threshold,
      ),
    )
  }

  @Test
  fun `swipe switches between chat and together deterministically in both directions`() {
    val threshold = 100f
    // TOGETHER 上滑回 CHAT；CHAT 下拉进入 TOGETHER。
    assertEquals(
      RavenCatPanelPage.CHAT,
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.TOGETHER, true, deltaX = 10f, deltaY = -150f, threshold,
      ),
    )
    assertEquals(
      RavenCatPanelPage.TOGETHER,
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.CHAT, true, deltaX = 10f, deltaY = 150f, threshold,
      ),
    )
    // 边界页继续同向 swipe 不越界。
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.TOGETHER, true, deltaX = 0f, deltaY = 150f, threshold,
      ),
    )
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.CHAT, true, deltaX = 0f, deltaY = -150f, threshold,
      ),
    )
    // Together 不存在时只有 CHAT 页，任何 swipe 都不切页。
    assertNull(
      RavenCatPanelPagerPolicy.resolveSwipeTarget(
        RavenCatPanelPage.CHAT, false, deltaX = 0f, deltaY = 300f, threshold,
      ),
    )
  }

  @Test
  fun `together ends on together page collapses but stays on chat page`() {
    assertTrue(
      RavenCatPanelPagerPolicy.shouldCollapseOnTogetherEnd(
        RavenCatOverlayWindowState.PANEL, RavenCatPanelPage.TOGETHER,
      ),
    )
    assertFalse(
      RavenCatPanelPagerPolicy.shouldCollapseOnTogetherEnd(
        RavenCatOverlayWindowState.PANEL, RavenCatPanelPage.CHAT,
      ),
    )
    assertFalse(
      RavenCatPanelPagerPolicy.shouldCollapseOnTogetherEnd(
        RavenCatOverlayWindowState.BUBBLE, RavenCatPanelPage.TOGETHER,
      ),
    )
  }

  @Test
  fun `transition policy collapses only when together truly ends on together page`() {
    // Together 结束 + 当前 TOGETHER 页 → 收起到 Bubble。
    assertTrue(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = true,
        nextTogetherActive = false,
        state = RavenCatOverlayWindowState.PANEL,
        currentPage = RavenCatPanelPage.TOGETHER,
      ),
    )
    // Together 结束 + 当前 CHAT 页 → 保持 Chat Panel。
    assertFalse(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = true,
        nextTogetherActive = false,
        state = RavenCatOverlayWindowState.PANEL,
        currentPage = RavenCatPanelPage.CHAT,
      ),
    )
    // Together 开始（CHAT 页可见）→ 不切页不收起。
    assertFalse(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = false,
        nextTogetherActive = true,
        state = RavenCatOverlayWindowState.PANEL,
        currentPage = RavenCatPanelPage.CHAT,
      ),
    )
    // 面板未打开时 projection 变化不得改变窗口状态。
    assertFalse(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = true,
        nextTogetherActive = false,
        state = RavenCatOverlayWindowState.BUBBLE,
        currentPage = RavenCatPanelPage.TOGETHER,
      ),
    )
  }

  @Test
  fun `together capsule is centered at fixed width on a 1080px screen`() {
    val density = 2f
    val capsule = RavenCatPanelPagerPolicy.togetherCapsuleBoundsPx(
      availableLeft = 0,
      availableTop = 0,
      availableWidthPx = 1080,
      availableHeightPx = 2200,
      density = density,
    )

    // 300dp 宽、84dp 高，顶部留白 12dp，水平居中。
    assertEquals((300 * density).toInt(), capsule.width)
    assertEquals((84 * density).toInt(), capsule.height)
    assertEquals((12 * density).toInt(), capsule.y)
    assertEquals((1080 - capsule.width) / 2, capsule.x)
  }

  @Test
  fun `together capsule sits below the available top inset`() {
    val density = 2f
    // available.top=80 表示状态栏/挖孔区域已被排除，胶囊不再叠加 inset。
    val capsule = RavenCatPanelPagerPolicy.togetherCapsuleBoundsPx(
      availableLeft = 0,
      availableTop = 80,
      availableWidthPx = 1080,
      availableHeightPx = 2120,
      density = density,
    )

    assertEquals(80 + (12 * density).toInt(), capsule.y)
    assertEquals((1080 - capsule.width) / 2, capsule.x)
  }

  @Test
  fun `together capsule width clamps with horizontal margin on small screens`() {
    val density = 2f
    // 200dp 宽的小屏：300dp 胶囊溢出，clamp 到 availableWidth - 32dp。
    val capsule = RavenCatPanelPagerPolicy.togetherCapsuleBoundsPx(
      availableLeft = 10,
      availableTop = 40,
      availableWidthPx = 400,
      availableHeightPx = 800,
      density = density,
    )

    assertEquals(400 - (32 * density).toInt(), capsule.width)
    assertEquals(10 + (400 - capsule.width) / 2, capsule.x)
    assertEquals(40 + (12 * density).toInt(), capsule.y)
    assertTrue(capsule.x >= 10)
    assertTrue(capsule.x + capsule.width <= 10 + 400)
  }

  @Test
  fun `together capsule height clamps to tiny available height`() {
    val capsule = RavenCatPanelPagerPolicy.togetherCapsuleBoundsPx(
      availableLeft = 0,
      availableTop = 0,
      availableWidthPx = 1080,
      availableHeightPx = 100,
      density = 2f,
    )

    assertEquals(100, capsule.height)
  }

  @Test
  fun `chat page keeps existing ratio and clamp rules`() {
    // 常规屏：PANEL_HEIGHT_RATIO 比例。
    assertEquals((2400 * 0.33f).toInt(), RavenCatPanelPagerPolicy.chatContentHeightPx(2400, 3f))
    // 超高屏：clamp 到 PANEL_MAX_HEIGHT_DP。
    assertEquals(320, RavenCatPanelPagerPolicy.chatContentHeightPx(2000, 1f))
    // 小屏（< 720dp）：0.25 比例低于 min，clamp 到 PANEL_MIN_HEIGHT_DP。
    assertEquals(440, RavenCatPanelPagerPolicy.chatContentHeightPx(1200, 2f))
  }
}
