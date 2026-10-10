package expo.modules.devicecontrol.view

import android.content.Context
import android.graphics.Color
import android.graphics.Rect
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

/**
 * DC2 最小 blocking View：不透明 RavenCat 身份、阻断说明与显式退出入口。
 * 根容器可点击并消费空白区域触摸；系统状态栏、导航栏与 IME 仍由系统拥有。
 * 阻断说明与「退出应用」按钮统一由原生持有，不加载用户页面。
 */
class SoftLockView(
  context: Context,
  onExitRequested: () -> Unit,
) : FrameLayout(context) {
  init {
    setBackgroundColor(BACKGROUND_COLOR)
    isClickable = true
    isFocusable = false

    addView(
      buildContent(onExitRequested),
      LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
        Gravity.CENTER,
      ),
    )
  }

  private fun buildContent(onExitRequested: () -> Unit): LinearLayout {
    val content = LinearLayout(context)
    content.orientation = LinearLayout.VERTICAL
    content.gravity = Gravity.CENTER_HORIZONTAL
    content.setPadding(dp(32), dp(32), dp(32), dp(32))

    val brand = TextView(context).apply {
      text = "RavenCat"
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, 28f)
      setTypeface(typeface, Typeface.BOLD)
      gravity = Gravity.CENTER
    }
    content.addView(
      brand,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ),
    )

    val message = TextView(context).apply {
      text = "该应用已暂时锁定"
      setTextColor(MESSAGE_COLOR)
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, 18f)
      gravity = Gravity.CENTER
    }
    content.addView(
      message,
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.WRAP_CONTENT,
      ).apply {
        topMargin = dp(20)
      },
    )

    content.addView(
      buildExitButton(onExitRequested),
      LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        dp(52),
      ).apply {
        topMargin = dp(36)
      },
    )

    return content
  }

  private fun buildExitButton(onExitRequested: () -> Unit): Button {
    return Button(context).apply {
      text = "退出应用"
      isAllCaps = false
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14f)
      setOnClickListener { onExitRequested() }
    }
  }

  /** 只约束内容操作区；根背景仍保持 MATCH_PARENT 全屏不透明。 */
  fun applySafeBounds(screenBounds: Rect, availableBounds: Rect) {
    setPadding(
      (availableBounds.left - screenBounds.left).coerceAtLeast(0),
      (availableBounds.top - screenBounds.top).coerceAtLeast(0),
      (screenBounds.right - availableBounds.right).coerceAtLeast(0),
      (screenBounds.bottom - availableBounds.bottom).coerceAtLeast(0),
    )
  }

  override fun onTouchEvent(event: MotionEvent): Boolean = true

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  private companion object {
    val BACKGROUND_COLOR: Int = Color.rgb(13, 14, 18)
    val MESSAGE_COLOR: Int = Color.rgb(224, 226, 232)
  }
}
