package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.widget.TextView
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayIntent
import java.util.UUID

/** 截图入口收缩为输入框左侧的小圆钮，与发送键分处输入框两端，避免误触。 */
internal class RavenCatShotActionView(
  context: Context,
  onIntent: (RavenCatOverlayIntent) -> Unit,
) : TextView(context) {
  init {
    text = "Shot"
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11f)
    gravity = Gravity.CENTER
    setTextColor(Color.parseColor("#374151"))
    background = GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.parseColor("#FFFFFF"))
      setStroke(dp(1), Color.parseColor("#E5E7EB"))
    }
    isClickable = true
    isFocusable = true
    contentDescription = "截取当前屏幕并暂存到输入区"
    setOnClickListener {
      onIntent(RavenCatOverlayIntent.Shot(buildCorrelationId()))
    }
  }

  private fun buildCorrelationId(): String {
    return "floating_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
