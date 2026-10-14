package expo.modules.nativetextselection

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import expo.modules.core.interfaces.Package

/** Expo 本地模块发现同时注册专用 RN 滚动视图，不替换应用其他滚动容器。 */
class NativeTextSelectionPackage : Package, ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(SelectionScrollViewManager())
}
