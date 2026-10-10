package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayIntent
import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPage

/** 共享头部：两个 page 都有一致的标题与收起入口；收起永远只收起到 Bubble。 */
internal class RavenCatPanelHeaderView(
  context: Context,
  onIntent: (RavenCatOverlayIntent) -> Unit,
) : LinearLayout(context) {
  private val titleView = TextView(context).apply {
    text = "RavenCat"
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14f)
    typeface = Typeface.DEFAULT_BOLD
    setTextColor(Color.parseColor("#111827"))
    includeFontPadding = false
  }

  private val collapseButton = TextView(context).apply {
    text = "收起"
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12f)
    gravity = Gravity.CENTER
    setTextColor(Color.parseColor("#4B5563"))
    background = GradientDrawable().apply {
      cornerRadius = dp(14).toFloat()
      setColor(Color.parseColor("#F3F4F6"))
    }
    isClickable = true
    isFocusable = true
    contentDescription = "收起 RavenCat 悬浮层"
    setOnClickListener { onIntent(RavenCatOverlayIntent.Collapse) }
  }

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL

    addView(
      titleView,
      LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f),
    )

    addView(
      collapseButton,
      LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT),
    )
    applyPagePadding(RavenCatPanelPage.CHAT)
  }

  /**
   * 标题跟随当前 page；收起入口位置与语义在两个 page 中保持一致。
   * TOGETHER 胶囊总高只有 84dp，header 压扁到约 24dp；CHAT 保持原大面板间距。
   */
  fun setPage(page: RavenCatPanelPage) {
    titleView.text = when (page) {
      RavenCatPanelPage.CHAT -> "RavenCat"
      RavenCatPanelPage.TOGETHER -> "一起听"
    }
    applyPagePadding(page)
  }

  private fun applyPagePadding(page: RavenCatPanelPage) {
    if (page == RavenCatPanelPage.TOGETHER) {
      setPadding(dp(COMPACT_START_PADDING_DP), 0, 0, dp(COMPACT_BOTTOM_PADDING_DP))
      collapseButton.setPadding(
        dp(COMPACT_BUTTON_HORIZONTAL_PADDING_DP),
        dp(COMPACT_BUTTON_VERTICAL_PADDING_DP),
        dp(COMPACT_BUTTON_HORIZONTAL_PADDING_DP),
        dp(COMPACT_BUTTON_VERTICAL_PADDING_DP),
      )
    } else {
      setPadding(dp(CHAT_START_PADDING_DP), dp(CHAT_TOP_PADDING_DP), 0, dp(CHAT_BOTTOM_PADDING_DP))
      collapseButton.setPadding(
        dp(CHAT_BUTTON_HORIZONTAL_PADDING_DP),
        dp(CHAT_BUTTON_VERTICAL_PADDING_DP),
        dp(CHAT_BUTTON_HORIZONTAL_PADDING_DP),
        dp(CHAT_BUTTON_VERTICAL_PADDING_DP),
      )
    }
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private companion object {
    const val CHAT_START_PADDING_DP = 4
    const val CHAT_TOP_PADDING_DP = 2
    const val CHAT_BOTTOM_PADDING_DP = 6
    const val CHAT_BUTTON_HORIZONTAL_PADDING_DP = 12
    const val CHAT_BUTTON_VERTICAL_PADDING_DP = 5
    const val COMPACT_START_PADDING_DP = 2
    const val COMPACT_BOTTOM_PADDING_DP = 2
    const val COMPACT_BUTTON_HORIZONTAL_PADDING_DP = 10
    const val COMPACT_BUTTON_VERTICAL_PADDING_DP = 2
  }
}
