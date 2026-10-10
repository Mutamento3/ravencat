package expo.modules.ravencatfloatinglayer.view

import expo.modules.ravencatfloatinglayer.model.RavenCatOverlaySnapshot

/** Renderer 只把 snapshot 映射到 View，不查询或持有业务状态。 */
internal class RavenCatOverlayRenderer {
  fun render(
    snapshot: RavenCatOverlaySnapshot,
    bubbleView: RavenCatBubbleView?,
    panelView: RavenCatPanelView?,
  ) {
    bubbleView?.render(snapshot)
    panelView?.render(snapshot)
  }
}
