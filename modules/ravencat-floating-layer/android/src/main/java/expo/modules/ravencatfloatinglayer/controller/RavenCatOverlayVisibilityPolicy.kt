package expo.modules.ravencatfloatinglayer.controller

/**
 * Overlay 的可见性策略只保留真正会暂时隐藏窗口的原因。
 *
 * APP_FOREGROUND_HOST 为 null 语义表示 Host 尚未建立前台事实；在收到明确的
 * background 事实前必须 fail-closed，避免 Service 重启或冷启动时在 App UI 上方
 * 闪出悬浮层。
 *
 * APP_FOREGROUND_NATIVE_ACTIVITY 是独立的 native fail-safe：由 Application
 * ActivityLifecycleCallbacks 驱动，即使 JS 线程崩溃、Host bridge 未执行，
 * RavenCat Activity resume 也必须立即隐藏 overlay。两个 foreground reason
 * 互不 release，最终可见性要求全部 reason 为空（fail-closed）。
 */
internal enum class RavenCatOverlaySuppressionReason {
  APP_FOREGROUND_HOST,
  APP_FOREGROUND_NATIVE_ACTIVITY,
  SCREEN_CAPTURE,
  EXCLUSIVE_INTERACTION,
}

internal class RavenCatOverlayVisibilityPolicy {
  // 初始 APP_FOREGROUND_HOST 同时承担 unknown fail-closed；只有明确 background 才释放它。
  private val suppressionReasons = mutableSetOf(
    RavenCatOverlaySuppressionReason.APP_FOREGROUND_HOST,
  )

  /** reason-set 为空时才允许展示；unknown 由初始 APP_FOREGROUND_HOST suppression 表达。 */
  val shouldShow: Boolean
    get() = suppressionReasons.isEmpty()

  fun setAppForeground(active: Boolean?) {
    if (active == false) {
      suppressionReasons.remove(RavenCatOverlaySuppressionReason.APP_FOREGROUND_HOST)
    } else {
      suppressionReasons.add(RavenCatOverlaySuppressionReason.APP_FOREGROUND_HOST)
    }
  }

  fun acquire(reason: RavenCatOverlaySuppressionReason) {
    suppressionReasons.add(reason)
  }

  fun release(reason: RavenCatOverlaySuppressionReason) {
    suppressionReasons.remove(reason)
  }

  fun has(reason: RavenCatOverlaySuppressionReason): Boolean =
    reason in suppressionReasons

  fun hasAnySuppression(): Boolean = suppressionReasons.isNotEmpty()
}
