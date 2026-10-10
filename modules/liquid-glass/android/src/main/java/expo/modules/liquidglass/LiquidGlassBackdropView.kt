package expo.modules.liquidglass

import android.content.Context
import android.util.Log
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/** 承载允许被采样的 React Native 背景内容，并按场景 ID 注册自身。 */
class LiquidGlassBackdropView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {
  private var sceneId = DEFAULT_SCENE_ID

  init {
    orientation = VERTICAL
    clipChildren = false
    clipToPadding = false
  }

  // React Native 会直接对子视图调用 measure/layout；LinearLayout 默认的 onLayout
  // 会按自己的规则重排子视图，把 Yoga 算好的帧冲掉（壁纸 Image 因此不可见），
  // 所以这里与 ReactViewGroup 一样保持空实现。
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  fun setSceneId(value: String) {
    val nextSceneId = value.trim().ifEmpty {
      Log.w(TAG, "收到空 sceneId，背景源回退到默认 app 场景。")
      DEFAULT_SCENE_ID
    }
    if (nextSceneId == sceneId) {
      return
    }

    if (isAttachedToWindow) {
      LiquidGlassSceneRegistry.unregisterBackdrop(sceneId, this)
    }
    sceneId = nextSceneId
    if (isAttachedToWindow) {
      LiquidGlassSceneRegistry.registerBackdrop(sceneId, this)
    }
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    LiquidGlassSceneRegistry.registerBackdrop(sceneId, this)
  }

  override fun onDetachedFromWindow() {
    LiquidGlassSceneRegistry.unregisterBackdrop(sceneId, this)
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(width: Int, height: Int, oldWidth: Int, oldHeight: Int) {
    super.onSizeChanged(width, height, oldWidth, oldHeight)
    if (width > 0 && height > 0 && isAttachedToWindow) {
      LiquidGlassSceneRegistry.refreshBackdrop(sceneId, this)
    }
  }

  fun dispose() {
    if (isAttachedToWindow) {
      // RN 在返回手势开始时就 drop 视图实例，但退出动画期间背景仍 attached 且被
      // 效果层采样；此时注销会让整个场景的 capture 销毁、玻璃全部闪回底色。
      // 清理推迟到 onDetachedFromWindow。
      return
    }
    LiquidGlassSceneRegistry.unregisterBackdrop(sceneId, this)
  }

  private companion object {
    const val DEFAULT_SCENE_ID = "app"
    const val TAG = "LiquidGlassBackdrop"
  }
}
