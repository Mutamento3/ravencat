package expo.modules.liquidglass

import android.graphics.RenderNode
import android.view.ViewTreeObserver
import java.lang.ref.WeakReference

/**
 * 每个场景只录制一次背景；效果层共享 RenderNode，避免按玻璃实例数重复遍历背景树。
 */
internal class LiquidGlassSceneCapture(
  source: LiquidGlassBackdropView
) : ViewTreeObserver.OnPreDrawListener {
  val renderNode = RenderNode("KimiPhoneLiquidGlassScene")

  private val sourceReference = WeakReference(source)
  private val effects = mutableListOf<WeakReference<LiquidGlassEffectView>>()
  private var observedTree: ViewTreeObserver? = null

  val source: LiquidGlassBackdropView?
    get() = sourceReference.get()

  fun attach(effect: LiquidGlassEffectView) {
    pruneEffects()
    if (effects.none { it.get() === effect }) {
      effects.add(WeakReference(effect))
    }
    ensureListening()
    if (renderNode.hasDisplayList()) {
      effect.onSharedSceneFrame(this)
    } else {
      refresh()
    }
  }

  fun detach(effect: LiquidGlassEffectView) {
    effects.removeAll { reference ->
      val current = reference.get()
      current == null || current === effect
    }
    if (effects.isEmpty()) {
      stopListening()
    }
  }

  fun refresh() {
    val currentSource = source ?: return
    if (!currentSource.isAttachedToWindow || currentSource.width <= 0 || currentSource.height <= 0) {
      return
    }

    record(currentSource)
    notifyEffects()
  }

  override fun onPreDraw(): Boolean {
    refresh()
    return true
  }

  fun dispose() {
    stopListening()
    effects.clear()
    renderNode.discardDisplayList()
  }

  private fun ensureListening() {
    val currentSource = source ?: return
    val nextTree = currentSource.viewTreeObserver
    if (observedTree === nextTree && nextTree.isAlive) {
      return
    }

    stopListening()
    if (nextTree.isAlive) {
      nextTree.addOnPreDrawListener(this)
      observedTree = nextTree
    }
  }

  private fun stopListening() {
    val tree = observedTree
    if (tree != null && tree.isAlive) {
      tree.removeOnPreDrawListener(this)
    }
    observedTree = null
  }

  private fun record(currentSource: LiquidGlassBackdropView) {
    val width = currentSource.width
    val height = currentSource.height
    renderNode.setPosition(0, 0, width, height)
    val canvas = renderNode.beginRecording(width, height)
    currentSource.draw(canvas)
    renderNode.endRecording()
  }

  private fun notifyEffects() {
    effects.removeAll { reference ->
      val effect = reference.get()
      if (effect == null) {
        true
      } else {
        effect.onSharedSceneFrame(this)
        false
      }
    }
  }

  private fun pruneEffects() {
    effects.removeAll { it.get() == null }
  }
}
