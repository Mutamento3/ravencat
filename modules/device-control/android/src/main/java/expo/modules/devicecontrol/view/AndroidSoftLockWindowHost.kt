package expo.modules.devicecontrol.view

import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.WindowInsets
import android.view.WindowManager
import expo.modules.androidoverlayruntime.OverlayBoundsResolver
import expo.modules.androidoverlayruntime.OverlayWindowConfig
import expo.modules.androidoverlayruntime.OverlayWindowHost
import expo.modules.devicecontrol.controller.SoftLockWindowHost
import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode

/** 复用 android-overlay-runtime primitive 的 Soft Lock 专属 Window adapter。 */
class AndroidSoftLockWindowHost(
  private val context: Context,
) : SoftLockWindowHost {
  private val windowHost = OverlayWindowHost(context)
  private val boundsResolver = OverlayBoundsResolver(context)
  private var view: SoftLockView? = null

  private val layoutParams = OverlayWindowConfig(
    width = WindowManager.LayoutParams.MATCH_PARENT,
    height = WindowManager.LayoutParams.MATCH_PARENT,
    gravity = Gravity.TOP or Gravity.START,
    type = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    format = PixelFormat.OPAQUE,
    flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
  ).toLayoutParams().apply {
    @Suppress("DEPRECATION")
    layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
  }

  override fun add(lockId: String, onFailure: (SoftLockFailure) -> Unit) {
    val blockingView = SoftLockView(context) {
      try {
        // 退出被锁 App：Android 无法 force-stop 其他应用，回桌面即用户感知的"退出"
        context.startActivity(homeIntent())
      } catch (error: RuntimeException) {
        onFailure(
          SoftLockFailure(
            code = SoftLockFailureCode.LAUNCH_FAILED,
            message = error.message ?: "无法退出应用",
          ),
        )
      }
    }
    applySafeBounds(blockingView, windowInsets = null)
    blockingView.setOnApplyWindowInsetsListener { _, insets ->
      applySafeBounds(blockingView, insets)
      insets
    }

    view = blockingView
    try {
      windowHost.add(blockingView, layoutParams)
    } catch (error: RuntimeException) {
      view = null
      throw error
    }
    blockingView.requestApplyInsets()
  }

  override fun remove() {
    val blockingView = checkNotNull(view) {
      "Soft Lock window owner 声称 attached，但 host 中没有 View"
    }
    try {
      windowHost.remove(blockingView)
    } finally {
      view = null
    }
  }

  private fun applySafeBounds(view: SoftLockView, windowInsets: WindowInsets?) {
    val screenBounds = boundsResolver.resolveScreenBounds()
    val availableBounds = if (windowInsets == null) {
      boundsResolver.resolveAvailableBounds()
    } else {
      boundsResolver.resolveAvailableBounds(windowInsets)
    }
    view.applySafeBounds(screenBounds, availableBounds)
  }

  private fun homeIntent(): Intent {
    return Intent(Intent.ACTION_MAIN).apply {
      addCategory(Intent.CATEGORY_HOME)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
  }
}
