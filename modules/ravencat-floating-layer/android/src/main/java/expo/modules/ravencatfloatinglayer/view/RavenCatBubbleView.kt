package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.FrameLayout
import android.widget.ImageView
import expo.modules.ravencatfloatinglayer.BubbleSkinStore
import expo.modules.ravencatfloatinglayer.BubbleSkin
import expo.modules.ravencatfloatinglayer.model.RavenCatBubbleDockSide
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayIntent
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlaySnapshot
import java.util.concurrent.Executors
import java.util.concurrent.Future

internal class RavenCatBubbleView(
  context: Context,
  private val onIntent: (RavenCatOverlayIntent) -> Unit,
) : FrameLayout(context) {
  private val skinStore = BubbleSkinStore(context)
  private val imageView = ImageView(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    scaleType = ImageView.ScaleType.FIT_CENTER
    contentDescription = "展开 RavenCat"
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private var loadedSkin: BubbleSkin? = null
  private var normalDrawable: Drawable? = null
  private var dockedDrawable: Drawable? = null
  private var currentSide = RavenCatBubbleDockSide.NONE
  private var displayedDrawable: Drawable? = null
  private var pendingLoad: Future<*>? = null
  private var loadGeneration = 0
  private var loadedSizeDp = 0

  init {
    addView(imageView)
    elevation = dp(10).toFloat()
    isClickable = true
    isFocusable = true
    setOnClickListener { onIntent(RavenCatOverlayIntent.Expand) }
  }

  fun render(snapshot: RavenCatOverlaySnapshot) {
    val skin = snapshot.bubbleSkin ?: return
    currentSide = snapshot.bubbleDockSide
    // 位置与消息投影不拥有图片生命周期。每套皮肤只解码一次，两种形态在拖动时直接复用。
    if (loadedSkin != skin || loadedSizeDp != snapshot.bubbleSizeDp) {
      loadedSkin = skin
      loadedSizeDp = snapshot.bubbleSizeDp
      pendingLoad?.cancel(false)
      val generation = ++loadGeneration
      normalDrawable = null
      dockedDrawable = null
      val targetEdge = dp(snapshot.bubbleSizeDp)
      pendingLoad = imageExecutor.submit {
        val images = try {
          loadImages(skin, targetEdge)
        } catch (error: Exception) {
          Log.e(TAG, "无法渲染 RavenCat 悬浮球皮肤 ${skin.id}", error)
          // 文件属于系统边界；损坏时只在此处降级一次，不在每次拖动中重试。
          loadImages(checkNotNull(snapshot.bubbleFallbackSkin), targetEdge)
        }
        mainHandler.post {
          // 换皮肤或 View 已移除时，旧解码结果不能覆盖当前形象。
          if (generation == loadGeneration) {
            normalDrawable = images.first
            dockedDrawable = images.second
            showCurrentForm()
          }
        }
      }
    }
    showCurrentForm()
  }

  private fun loadImages(skin: BubbleSkin, targetEdge: Int): Pair<Drawable, Drawable> {
    val normal = skinStore.drawableFor(skin, false, targetEdge)
    val docked = if (skin.hasDockedAsset) skinStore.drawableFor(skin, true, targetEdge) else normal
    return normal to docked
  }

  private fun showCurrentForm() {
    val docked = currentSide != RavenCatBubbleDockSide.NONE
    imageView.scaleX = if (docked && currentSide == RavenCatBubbleDockSide.LEFT) -1f else 1f
    val drawable = if (docked) dockedDrawable else normalDrawable
    if (displayedDrawable !== drawable) {
      displayedDrawable = drawable
      imageView.setImageDrawable(drawable)
    }
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    ++loadGeneration
    pendingLoad?.cancel(false)
    loadedSkin = null
    normalDrawable = null
    dockedDrawable = null
    showCurrentForm()
  }

  private fun dp(value: Int): Int {
    return (value * resources.displayMetrics.density).toInt()
  }

  companion object {
    private const val TAG = "RavenCatFloating"
    private val imageExecutor = Executors.newSingleThreadExecutor()
  }
}
