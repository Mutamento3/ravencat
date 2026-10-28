package expo.modules.callruntime

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.view.animation.DecelerateInterpolator
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** React 只声明内容就绪；实际绘制帧与系统窗口的交接由原生层确认。 */
class CallPresentationView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var callId = ""
    set(value) {
      if (field == value) return
      if (isAttachedToWindow) overlay()?.presentationDetached(this)
      field = value
      if (isAttachedToWindow) overlay()?.attachPresentation(this)
    }
  var ready = false
    set(value) { field = value; invalidate() }
  private var request: Int? = null
  private var animator: ValueAnimator? = null
  private var opacity = 1f
  private var finished = false

  private fun overlay(): CallOverlayController? =
    if (CallExecutionRegistry.callId == callId) CallExecutionRegistry.host?.overlay else null

  // 子节点的位置由 Yoga 持有，不能让 LinearLayout 再按自己的规则排列一次。
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    overlay()?.attachPresentation(this)
  }

  override fun draw(canvas: Canvas) {
    val owner = overlay()
    val pending = owner?.pendingPresentation
    if (owner != null && pending != null) {
      if (!owner.ownsPresentation(this) || !ready || width == 0 || height == 0) return
      if (request != pending) {
        stopFade()
        request = pending
        opacity = 0f
        animator = ValueAnimator.ofFloat(0f, 1f).apply {
          duration = 160
          interpolator = DecelerateInterpolator()
          addUpdateListener {
            opacity = it.animatedValue as Float
            owner.setPresentationProgress(this@CallPresentationView, pending, opacity)
            invalidate()
          }
          addListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
              finished = true
              invalidate()
            }
          })
          start()
        }
      }
      // 只改变实际页面的透明度，窗口和内容坐标始终由原来的所有者持有。
      val layer = canvas.saveLayerAlpha(0f, 0f, width.toFloat(), height.toFloat(), (255 * opacity).toInt())
      super.draw(canvas)
      canvas.restoreToCount(layer)
      if (finished) postOnAnimation { owner.completeRestore(this, pending) }
      return
    }
    stopFade()
    super.draw(canvas)
  }

  private fun stopFade() {
    animator?.removeAllListeners()
    animator?.removeAllUpdateListeners()
    animator?.cancel()
    animator = null
    request = null
    opacity = 1f
    finished = false
  }

  override fun onDetachedFromWindow() {
    overlay()?.presentationDetached(this)
    stopFade()
    super.onDetachedFromWindow()
  }
}
