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
  var revision = 0L
    private set
  private var capturedSourceRevision = Long.MIN_VALUE

  private val sourceReference = WeakReference(source)
  private val effects = mutableListOf<WeakReference<LiquidGlassEffectView>>()
  private val observedTrees = mutableSetOf<ViewTreeObserver>()

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
    } else {
      ensureListening()
    }
  }

  fun refresh() {
    val currentSource = source ?: return
    if (!currentSource.isAttachedToWindow || currentSource.width <= 0 || currentSource.height <= 0) {
      return
    }

    val sourceRevision = currentSource.contentRevision
    if (!renderNode.hasDisplayList() || capturedSourceRevision != sourceRevision) {
      record(currentSource)
      capturedSourceRevision = sourceRevision
      revision++
    }
    // 滚动会移动玻璃而不改变背景，效果层仍需检查自己的采样位置。
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
    // Modal 属于独立窗口。主页面静止时，弹窗仍需在自己的 preDraw 更新采样位置，
    // 否则滑入期间会一直使用挂载时的屏外坐标，先透明、等主窗口重绘后才出现材质。
    val nextTrees = mutableSetOf(currentSource.viewTreeObserver)
    for (reference in effects) {
      val effect = reference.get() ?: continue
      if (effect.isAttachedToWindow) nextTrees.add(effect.viewTreeObserver)
    }
    nextTrees.removeAll { !it.isAlive }

    // 同一窗口的全部表面共用一个监听；关闭弹窗时只移除其窗口，不增加空闲刷新。
    for (tree in observedTrees) {
      if (tree !in nextTrees && tree.isAlive) tree.removeOnPreDrawListener(this)
    }
    for (tree in nextTrees) {
      if (tree !in observedTrees) tree.addOnPreDrawListener(this)
    }
    observedTrees.clear()
    observedTrees.addAll(nextTrees)
  }

  private fun stopListening() {
    for (tree in observedTrees) {
      if (tree.isAlive) tree.removeOnPreDrawListener(this)
    }
    observedTrees.clear()
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
