package expo.modules.ravencatfloatinglayer.controller

internal enum class RavenCatOverlayWindowState {
  BUBBLE,
  PANEL,
  HIDDEN,
}

internal enum class RavenCatOverlayWindowEvent {
  SHOW_BUBBLE,
  EXPAND,
  COLLAPSE,
  HIDE,
}

/** 可执行的纯状态接缝，窗口副作用仍由 Controller 完成。 */
internal object RavenCatOverlayWindowStateReducer {
  fun reduce(
    state: RavenCatOverlayWindowState,
    event: RavenCatOverlayWindowEvent,
  ): RavenCatOverlayWindowState {
    return when (event) {
      RavenCatOverlayWindowEvent.SHOW_BUBBLE -> RavenCatOverlayWindowState.BUBBLE
      RavenCatOverlayWindowEvent.EXPAND -> if (state == RavenCatOverlayWindowState.BUBBLE) {
        RavenCatOverlayWindowState.PANEL
      } else {
        state
      }
      RavenCatOverlayWindowEvent.COLLAPSE -> if (state == RavenCatOverlayWindowState.PANEL) {
        RavenCatOverlayWindowState.BUBBLE
      } else {
        state
      }
      RavenCatOverlayWindowEvent.HIDE -> RavenCatOverlayWindowState.HIDDEN
    }
  }
}
