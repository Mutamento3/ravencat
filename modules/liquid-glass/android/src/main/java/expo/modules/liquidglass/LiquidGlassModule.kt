package expo.modules.liquidglass

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class LiquidGlassModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LiquidGlass")

    View(LiquidGlassBackdropView::class) {
      Name("LiquidGlassBackdropView")

      Prop("sceneId") { view: LiquidGlassBackdropView, value: String ->
        view.setSceneId(value)
      }

      OnViewDestroys { view: LiquidGlassBackdropView ->
        view.dispose()
      }
    }

    View(LiquidGlassEffectView::class) {
      Name("LiquidGlassEffectView")

      Prop("sceneId") { view: LiquidGlassEffectView, value: String ->
        view.setSceneId(value)
      }
      Prop("blurRadius") { view: LiquidGlassEffectView, value: Float ->
        view.setBlurRadius(value)
      }
      Prop("cornerRadius") { view: LiquidGlassEffectView, value: Float ->
        view.setCornerRadius(value)
      }
      Prop("refractionHeight") { view: LiquidGlassEffectView, value: Float ->
        view.setRefractionHeight(value)
      }
      Prop("refractionOffset") { view: LiquidGlassEffectView, value: Float ->
        view.setRefractionOffset(value)
      }
      Prop("dispersion") { view: LiquidGlassEffectView, value: Float ->
        view.setDispersion(value)
      }
      Prop("tintColor") { view: LiquidGlassEffectView, value: String ->
        view.setTintColor(value)
      }
      Prop("tintAlpha") { view: LiquidGlassEffectView, value: Float ->
        view.setTintAlpha(value)
      }

      OnViewDestroys { view: LiquidGlassEffectView ->
        view.dispose()
      }
    }
  }
}
