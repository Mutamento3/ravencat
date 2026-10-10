package expo.modules.ravencatfloatinglayer.model

import expo.modules.ravencatfloatinglayer.controller.RavenCatOverlayWindowState
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/**
 * PANEL 窗口内的 page/content mode。它是纯 native presentation state：
 * 不是 Together Activity truth，也不是 overlay lifecycle state
 * （窗口状态仍只有 BUBBLE / PANEL / HIDDEN）。
 */
internal enum class RavenCatPanelPage {
  CHAT,
  TOGETHER,
}

/** TOGETHER 页悬浮胶囊的窗口几何（相对 available bounds，已排除状态栏/挖孔）。 */
internal data class RavenCatTogetherCapsuleBounds(
  val x: Int,
  val y: Int,
  val width: Int,
  val height: Int,
)

/** PANEL 页可用性、swipe 切换与每页窗口几何的纯策略，窗口副作用仍由 Controller 完成。 */
internal object RavenCatPanelPagerPolicy {
  /** Together 胶囊总高（含 header），不再叠加 status-bar inset。 */
  const val TOGETHER_CAPSULE_HEIGHT_DP = 84
  const val TOGETHER_CAPSULE_WIDTH_DP = 300
  const val TOGETHER_CAPSULE_TOP_MARGIN_DP = 12
  /** 小屏时胶囊两侧至少保留的水平边距（width clamp 用）。 */
  const val TOGETHER_CAPSULE_HORIZONTAL_MARGIN_DP = 32
  const val TOGETHER_CAPSULE_CORNER_RADIUS_DP = 24

  private const val PANEL_HEIGHT_RATIO = 0.33f
  private const val SMALL_PANEL_HEIGHT_RATIO = 0.25f
  private const val SMALL_SCREEN_HEIGHT_DP = 720
  private const val PANEL_MIN_HEIGHT_DP = 220
  private const val PANEL_MAX_HEIGHT_DP = 320

  /** Together active 时点击 Bubble 默认先看到 Together compact page。 */
  fun initialPage(togetherActive: Boolean): RavenCatPanelPage =
    if (togetherActive) RavenCatPanelPage.TOGETHER else RavenCatPanelPage.CHAT

  /** 视觉顺序：CHAT 在上、TOGETHER 在下。 */
  fun availablePages(togetherActive: Boolean): List<RavenCatPanelPage> =
    if (togetherActive) {
      listOf(RavenCatPanelPage.CHAT, RavenCatPanelPage.TOGETHER)
    } else {
      listOf(RavenCatPanelPage.CHAT)
    }

  /**
   * 只有明确纵向 swipe 才切页：TOGETHER 上滑回 CHAT，CHAT 下拉进入 TOGETHER。
   * Chat ScrollView 是否已允许边界接力由 View 层判定。
   */
  fun resolveSwipeTarget(
    currentPage: RavenCatPanelPage,
    togetherActive: Boolean,
    deltaX: Float,
    deltaY: Float,
    verticalThresholdPx: Float,
  ): RavenCatPanelPage? {
    if (!togetherActive) return null
    if (abs(deltaY) < verticalThresholdPx || abs(deltaY) <= abs(deltaX)) return null
    return when {
      currentPage == RavenCatPanelPage.TOGETHER && deltaY < 0 -> RavenCatPanelPage.CHAT
      currentPage == RavenCatPanelPage.CHAT && deltaY > 0 -> RavenCatPanelPage.TOGETHER
      else -> null
    }
  }

  /**
   * Together 结束时的面板去留：只有用户当前停在 TOGETHER 页才收起到 Bubble；
   * 停在 CHAT 页时不得抢走用户正在使用的 Chat Panel。
   */
  fun shouldCollapseOnTogetherEnd(
    state: RavenCatOverlayWindowState,
    currentPage: RavenCatPanelPage,
  ): Boolean =
    state == RavenCatOverlayWindowState.PANEL && currentPage == RavenCatPanelPage.TOGETHER

  /** Chat 页保持既有面板高度规则（屏幕比例 + min/max clamp）。 */
  fun chatContentHeightPx(availableHeightPx: Int, density: Float): Int {
    val ratio = if (availableHeightPx < dp(SMALL_SCREEN_HEIGHT_DP, density)) {
      SMALL_PANEL_HEIGHT_RATIO
    } else {
      PANEL_HEIGHT_RATIO
    }
    val preferredHeight = (availableHeightPx * ratio).toInt()
    val maxHeight = min(dp(PANEL_MAX_HEIGHT_DP, density), availableHeightPx)
    val minHeight = min(dp(PANEL_MIN_HEIGHT_DP, density), max(availableHeightPx / 2, 1))
    return min(max(preferredHeight, minHeight), maxHeight)
  }

  /**
   * Together 胶囊在 available bounds（已排除状态栏/挖孔）内的窗口几何：
   * 顶部留白后水平居中；小屏时宽度 clamp 到 availableWidth - 水平边距，不溢出。
   * 纯几何计算，不缓存结果，调用方（旋转/insets 变化）每次传入最新 available bounds。
   */
  fun togetherCapsuleBoundsPx(
    availableLeft: Int,
    availableTop: Int,
    availableWidthPx: Int,
    availableHeightPx: Int,
    density: Float,
  ): RavenCatTogetherCapsuleBounds {
    val width = max(
      min(
        dp(TOGETHER_CAPSULE_WIDTH_DP, density),
        availableWidthPx - dp(TOGETHER_CAPSULE_HORIZONTAL_MARGIN_DP, density),
      ),
      1,
    )
    val height = max(min(dp(TOGETHER_CAPSULE_HEIGHT_DP, density), availableHeightPx), 1)
    return RavenCatTogetherCapsuleBounds(
      x = availableLeft + (availableWidthPx - width) / 2,
      y = availableTop + dp(TOGETHER_CAPSULE_TOP_MARGIN_DP, density),
      width = width,
      height = height,
    )
  }

  private fun dp(value: Int, density: Float): Int = (value * density).toInt()
}
