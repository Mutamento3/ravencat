package expo.modules.nativetextselection

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import expo.modules.core.interfaces.Package

/** 注册 Fabric 规范名称的滚动管理器；文字选择策略由专用 JS 适配显式启用。 */
class NativeTextSelectionPackage : Package, ReactPackage {
  @Suppress("OVERRIDE_DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> = emptyList()
  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(SelectionScrollViewManager())
}
