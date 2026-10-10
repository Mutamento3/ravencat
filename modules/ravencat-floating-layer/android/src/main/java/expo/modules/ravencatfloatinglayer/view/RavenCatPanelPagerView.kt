package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPage
import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPagerPolicy

/**
 * PANEL 内 CHAT / TOGETHER 两个 page 的纵向切换容器。
 *
 * TOGETHER 上滑回 CHAT；CHAT 只有在消息区已到顶部或从非滚动背景起手时才接受下拉，
 * composer / Shot 等交互区由调用方排除。每次手势最多切一次。
 */
internal class RavenCatPanelPagerView(
  context: Context,
  private val chatPage: View,
  private val togetherPage: View,
  private val canStartChatPageSwipe: (x: Float, y: Float) -> Boolean,
  private val onPageChanged: (RavenCatPanelPage) -> Unit,
) : FrameLayout(context) {
  private var currentPage = RavenCatPanelPage.CHAT
  private var togetherAvailable = false
  private var downX = 0f
  private var downY = 0f
  private var tracking = false
  private var gestureConsumed = false
  private var chatPageSwipeEligible = false
  private val verticalThresholdPx = dp(SWIPE_THRESHOLD_DP).toFloat()

  init {
    addView(chatPage, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    addView(togetherPage, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    togetherPage.visibility = View.GONE
  }

  /** Together projection 出现时只开放 TOGETHER page，不强行切走用户当前页。 */
  fun setTogetherPageAvailable(available: Boolean) {
    if (togetherAvailable == available) return
    togetherAvailable = available
    if (!available && currentPage == RavenCatPanelPage.TOGETHER) {
      // Controller 通常已先收起到 Bubble；这里只是防御性回到唯一合法页。
      showPage(RavenCatPanelPage.CHAT, notify = true)
    }
  }

  fun currentPage(): RavenCatPanelPage = currentPage

  fun showPage(page: RavenCatPanelPage, notify: Boolean) {
    // 可用性守卫生成在 swipe（resolveSwipeTarget）与 setTogetherPageAvailable 中；
    // 这里信任调用方，expand 时 snapshot 已确定 initial page 合法。
    val changed = currentPage != page
    currentPage = page
    chatPage.visibility = if (page == RavenCatPanelPage.CHAT) View.VISIBLE else View.GONE
    togetherPage.visibility = if (page == RavenCatPanelPage.TOGETHER) View.VISIBLE else View.GONE
    if (changed && notify) onPageChanged(page)
  }

  /**
   * 手势判定走标准 ViewGroup 模型：onInterceptTouchEvent + onTouchEvent。
   *
   * 所有权分两半：
   * - onTouchEvent(ACTION_DOWN) 固定返回 true，保证 pager 自己始终是合法手势
   *   consumer。Together 页的 child 全部不可点击，若 pager 也不消费 DOWN，
   *   parent（RavenCatPanelView）不会把 pager 记为 touch target，后续
   *   MOVE/UP 根本送不到 pager，swipe 就永远失效。
   * - onInterceptTouchEvent 只在明确纵向 swipe 且 CHAT 边界允许接力时接管；
   *   拦截成功后框架自动向持有手势的 child 补发 ACTION_CANCEL。
   */
  override fun onInterceptTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        tracking = true
        gestureConsumed = false
        chatPageSwipeEligible = currentPage != RavenCatPanelPage.CHAT ||
          canStartChatPageSwipe(event.x, event.y)
      }
      MotionEvent.ACTION_MOVE -> {
        // 命中即在拦截点直接切页：框架拦截 MOVE 的当次分发只负责向持有手势的
        // child 补发 ACTION_CANCEL，该 MOVE 不会再进入 pager 自己的 onTouchEvent，
        // 等下一个 MOVE 才切页会慢一拍。
        if (tracking && !gestureConsumed) {
          val target = resolveSwipeTarget(event)
          if (target != null) {
            showPage(target, notify = true)
            tracking = false
            gestureConsumed = true
            return true
          }
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        tracking = false
        gestureConsumed = false
      }
    }
    return false
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        downX = event.x
        downY = event.y
        tracking = true
        gestureConsumed = false
        chatPageSwipeEligible = currentPage != RavenCatPanelPage.CHAT ||
          canStartChatPageSwipe(event.x, event.y)
      }
      MotionEvent.ACTION_MOVE -> {
        // 已切过页的手势直接吞掉，保证一次手势最多切一页。
        if (gestureConsumed) return true
        // 走到这里说明没有 child target（如 Together 页 child 不可点击）、
        // pager 自己消费了 DOWN；此时框架不会再回调 onInterceptTouchEvent，
        // 切页判定由这里负责。
        val target = if (tracking) resolveSwipeTarget(event) else null
        if (target != null) {
          showPage(target, notify = true)
          tracking = false
          gestureConsumed = true
        }
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        tracking = false
        gestureConsumed = false
      }
    }
    return true
  }

  /** 命中阈值且目标页存在时返回目标页；返回 null 表示保持当前页。 */
  private fun resolveSwipeTarget(event: MotionEvent): RavenCatPanelPage? {
    val target = RavenCatPanelPagerPolicy.resolveSwipeTarget(
      currentPage = currentPage,
      togetherActive = togetherAvailable,
      deltaX = event.x - downX,
      deltaY = event.y - downY,
      verticalThresholdPx = verticalThresholdPx,
    )
    return if (
      target != currentPage &&
      (target != RavenCatPanelPage.TOGETHER || chatPageSwipeEligible)
    ) target else null
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private companion object {
    const val SWIPE_THRESHOLD_DP = 48
  }
}
