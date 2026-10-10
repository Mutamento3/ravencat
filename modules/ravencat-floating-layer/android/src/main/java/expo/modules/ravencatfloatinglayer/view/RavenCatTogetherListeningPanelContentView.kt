package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Color
import android.graphics.Outline
import android.graphics.drawable.Drawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewOutlineProvider
import android.widget.Chronometer
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import expo.modules.ravencatfloatinglayer.R
import expo.modules.ravencatfloatinglayer.model.RavenCatTogetherListeningPresentation

/**
 * Together projection 的 Panel compact 内容：只有双方头像（AI 左、用户右）与
 * native elapsed duration，不展示名字、歌曲、按钮或播放控制（V1 freshness
 * contract）。标题与收起入口由共享 header 统一提供；进入 App 聊天由 standard
 * notification 的精确导航承担，悬浮层不再重复。
 */
internal class RavenCatTogetherListeningPanelContentView(
  context: Context,
) : LinearLayout(context) {
  private data class AvatarViews(
    val image: ImageView,
    val fallback: TextView,
  )

  private val aiAvatarSlot = AvatarSlot(
    createAvatarViews(),
    R.drawable.ravencat_default_ai_avatar,
  )
  private val userAvatarSlot = AvatarSlot(
    createAvatarViews(),
    R.drawable.ravencat_default_user_avatar,
  )
  private val durationView = Chronometer(context).apply {
    setTextSize(TypedValue.COMPLEX_UNIT_DIP, 13f)
    setTextColor(Color.parseColor("#6B7280"))
    gravity = Gravity.CENTER
    includeFontPadding = false
    setFormat("%s")
  }
  private var runningActivityId: String? = null
  private var runningActivatedAtEpochMs: Long? = null
  private var tickerRunning = false

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    setPadding(dp(8), 0, dp(8), dp(10))

    // AI 在左、用户在右，中间是时长。
    addView(
      wrapAvatar(aiAvatarSlot.views),
      LayoutParams(dp(AVATAR_SIZE_DP), dp(AVATAR_SIZE_DP)),
    )
    addView(durationView, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    addView(
      wrapAvatar(userAvatarSlot.views),
      LayoutParams(dp(AVATAR_SIZE_DP), dp(AVATAR_SIZE_DP)),
    )
  }

  fun render(presentation: RavenCatTogetherListeningPresentation?) {
    if (presentation == null) {
      stopTicker()
      return
    }

    aiAvatarSlot.render(presentation.aiAvatar, presentation.aiName)
    userAvatarSlot.render(presentation.userAvatar, presentation.userName)

    if (
      runningActivityId != presentation.activityId
      || runningActivatedAtEpochMs != presentation.activatedAtEpochMs
    ) {
      stopTicker()
      runningActivityId = presentation.activityId
      runningActivatedAtEpochMs = presentation.activatedAtEpochMs
      durationView.base = elapsedBase(presentation.activatedAtEpochMs)
      durationView.start()
      tickerRunning = true
    } else if (!tickerRunning) {
      durationView.start()
      tickerRunning = true
    }
  }

  override fun onDetachedFromWindow() {
    stopTicker()
    super.onDetachedFromWindow()
  }

  private fun wrapAvatar(views: AvatarViews): View {
    return FrameLayout(context).apply {
      // 头像槽固定为 36dp 方形，oval outline 把位图与首字 fallback 统一裁成圆形。
      outlineProvider = CIRCULAR_OUTLINE_PROVIDER
      clipToOutline = true
      addView(views.image, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
      addView(views.fallback, FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT,
      ))
      views.fallback.visibility = View.GONE
    }
  }

  private fun createAvatarViews(): AvatarViews {
    val image = ImageView(context).apply {
      scaleType = ImageView.ScaleType.CENTER_CROP
      setBackgroundColor(Color.parseColor("#E5E7EB"))
    }
    val fallback = TextView(context).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14f)
      gravity = Gravity.CENTER
      setTextColor(Color.parseColor("#6B7280"))
      setBackgroundColor(Color.parseColor("#E5E7EB"))
      includeFontPadding = false
    }
    return AvatarViews(image, fallback)
  }

  /**
   * 单侧头像的渲染状态。URI 未变化时不重复解码；仅首次渲染或 URI 变化才走
   * RavenCatAvatarLoader。未设置或解码失败时使用与 App 一致的产品默认头像；
   * 只有默认 drawable 不可用时才退回首字。
   */
  private inner class AvatarSlot(
    val views: AvatarViews,
    private val defaultAvatarResource: Int,
  ) {
    private var decoded = false
    private var decodedUri: String? = null
    private var drawable: Drawable? = null

    fun render(uri: String?, name: String) {
      val normalizedUri = uri?.trim()?.takeIf { it.isNotEmpty() }
      if (!decoded || decodedUri != normalizedUri) {
        decoded = true
        decodedUri = normalizedUri
        val customBitmap = normalizedUri?.let {
          RavenCatAvatarLoader.loadLocalAvatar(context, it, dp(AVATAR_SIZE_DP))
        }
        drawable = customBitmap
          ?.let { android.graphics.drawable.BitmapDrawable(resources, it) }
          ?: context.getDrawable(defaultAvatarResource)
        views.image.setImageDrawable(drawable)
      }
      if (drawable != null) {
        views.image.visibility = View.VISIBLE
        views.fallback.visibility = View.GONE
      } else {
        // 名字可能随 projection 更新，fallback 首字每次都刷新。
        views.image.visibility = View.GONE
        views.fallback.text = name.trim().firstOrNull()?.toString() ?: "?"
        views.fallback.visibility = View.VISIBLE
      }
    }
  }

  private fun elapsedBase(activatedAtEpochMs: Long): Long {
    val elapsedSinceActivation = (System.currentTimeMillis() - activatedAtEpochMs).coerceAtLeast(0L)
    return SystemClock.elapsedRealtime() - elapsedSinceActivation
  }

  private fun stopTicker() {
    if (tickerRunning) {
      durationView.stop()
      tickerRunning = false
    }
    runningActivityId = null
    runningActivatedAtEpochMs = null
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private companion object {
    const val AVATAR_SIZE_DP = 36

    // ViewOutlineProvider 没有内置 OVAL 常量，按 view 实际尺寸输出 oval。
    val CIRCULAR_OUTLINE_PROVIDER = object : ViewOutlineProvider() {
      override fun getOutline(view: View, outline: Outline) {
        outline.setOval(0, 0, view.width, view.height)
      }
    }
  }
}
