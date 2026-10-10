package expo.modules.androidoverlayruntime

import android.graphics.Rect
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class OverlaySize(val width: Int, val height: Int)

data class OverlayEdgeSnapConfig(
  val detectionDistance: Int,
  val visibleRatio: Float,
)

enum class OverlayHorizontalEdge {
  LEFT,
  RIGHT,
}

data class OverlayDragRelease(
  val position: OverlayPosition,
  val snapPosition: OverlayPosition?,
  val snapEdge: OverlayHorizontalEdge?,
)

/** 提供悬浮窗口可见边界与水平贴边计算。 */
object OverlayGeometry {
  fun constrainVisible(
    position: OverlayPosition,
    size: OverlaySize,
    bounds: Rect,
  ): OverlayPosition {
    return OverlayPosition(
      x = min(max(position.x, bounds.left), max(bounds.right - size.width, bounds.left)),
      y = min(max(position.y, bounds.top), max(bounds.bottom - size.height, bounds.top)),
    )
  }

  fun resolveDragRelease(
    position: OverlayPosition,
    size: OverlaySize,
    bounds: Rect,
    edgeSnapConfig: OverlayEdgeSnapConfig?,
  ): OverlayDragRelease {
    val visiblePosition = constrainVisible(position, size, bounds)
    if (edgeSnapConfig == null) {
      return OverlayDragRelease(visiblePosition, null, null)
    }

    val visibleWidth = (size.width * edgeSnapConfig.visibleRatio).roundToInt()
    return when {
      visiblePosition.x <= bounds.left + edgeSnapConfig.detectionDistance -> OverlayDragRelease(
        position = visiblePosition,
        snapPosition = OverlayPosition(
          x = bounds.left + visibleWidth - size.width,
          y = visiblePosition.y,
        ),
        snapEdge = OverlayHorizontalEdge.LEFT,
      )
      visiblePosition.x + size.width >= bounds.right - edgeSnapConfig.detectionDistance -> OverlayDragRelease(
        position = visiblePosition,
        snapPosition = OverlayPosition(
          x = bounds.right - visibleWidth,
          y = visiblePosition.y,
        ),
        snapEdge = OverlayHorizontalEdge.RIGHT,
      )
      else -> OverlayDragRelease(visiblePosition, null, null)
    }
  }
}
