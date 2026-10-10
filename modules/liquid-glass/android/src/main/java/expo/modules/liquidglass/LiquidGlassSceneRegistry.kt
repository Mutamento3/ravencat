package expo.modules.liquidglass

import java.lang.ref.WeakReference

/** 用场景 ID 连接背景与效果，并为同场景复用唯一的背景捕获节点。 */
internal object LiquidGlassSceneRegistry {
  private val backdrops = mutableMapOf<String, WeakReference<LiquidGlassBackdropView>>()
  private val effects =
    mutableMapOf<String, MutableList<WeakReference<LiquidGlassEffectView>>>()
  private val captures = mutableMapOf<String, LiquidGlassSceneCapture>()

  fun registerBackdrop(sceneId: String, backdrop: LiquidGlassBackdropView) {
    prune()
    val previousBackdrop = backdrops[sceneId]?.get()
    if (previousBackdrop !== backdrop) {
      captures.remove(sceneId)?.dispose()
    }
    backdrops[sceneId] = WeakReference(backdrop)
    notifyEffects(sceneId)
  }

  fun refreshBackdrop(sceneId: String, backdrop: LiquidGlassBackdropView) {
    if (backdrops[sceneId]?.get() === backdrop) {
      captures[sceneId]?.refresh()
      notifyEffects(sceneId)
    }
  }

  fun unregisterBackdrop(sceneId: String, backdrop: LiquidGlassBackdropView) {
    if (backdrops[sceneId]?.get() === backdrop) {
      backdrops.remove(sceneId)
      captures.remove(sceneId)?.dispose()
      notifyEffects(sceneId)
    }
    prune()
  }

  fun registerEffect(sceneId: String, effect: LiquidGlassEffectView) {
    prune()
    val sceneEffects = effects.getOrPut(sceneId) { mutableListOf() }
    if (sceneEffects.none { it.get() === effect }) {
      sceneEffects.add(WeakReference(effect))
    }
    effect.onSceneSourceChanged()
  }

  fun unregisterEffect(sceneId: String, effect: LiquidGlassEffectView) {
    captures[sceneId]?.detach(effect)
    effects[sceneId]?.removeAll { reference ->
      val current = reference.get()
      current == null || current === effect
    }
    if (effects[sceneId].isNullOrEmpty()) {
      effects.remove(sceneId)
    }
    prune()
  }

  fun backdropFor(sceneId: String): LiquidGlassBackdropView? {
    val backdrop = backdrops[sceneId]?.get()
    if (backdrop == null) {
      backdrops.remove(sceneId)
      captures.remove(sceneId)?.dispose()
    }
    return backdrop
  }

  fun captureFor(sceneId: String): LiquidGlassSceneCapture? {
    val backdrop = backdropFor(sceneId) ?: return null
    val existing = captures[sceneId]
    if (existing?.source === backdrop) {
      return existing
    }

    existing?.dispose()
    return LiquidGlassSceneCapture(backdrop).also { capture ->
      captures[sceneId] = capture
    }
  }

  private fun notifyEffects(sceneId: String) {
    effects[sceneId]?.removeAll { reference ->
      val effect = reference.get()
      if (effect == null) {
        true
      } else {
        effect.onSceneSourceChanged()
        false
      }
    }
  }

  private fun prune() {
    backdrops.entries.removeAll { (sceneId, reference) ->
      val shouldRemove = reference.get() == null
      if (shouldRemove) {
        captures.remove(sceneId)?.dispose()
      }
      shouldRemove
    }
    effects.entries.removeAll { (_, references) ->
      references.removeAll { it.get() == null }
      references.isEmpty()
    }
  }
}
