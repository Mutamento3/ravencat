package expo.modules.androidoverlayruntime

import android.content.Context
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs

/** 将触摸序列转换为点击或拖动位置更新。 */
class DraggableOverlayBehavior(
  context: Context,
  private val overlaySize: OverlaySize,
  private val availableBounds: () -> android.graphics.Rect,
  private val edgeSnapConfig: OverlayEdgeSnapConfig? = null,
  private val currentPosition: () -> OverlayPosition,
  private val onDragStarted: () -> Unit,
  private val onPositionChanged: (OverlayPosition) -> Unit,
  private val onDragFinished: (OverlayDragRelease) -> Unit,
) : View.OnTouchListener {
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private var downRawX = 0f
  private var downRawY = 0f
  private var startPosition = OverlayPosition(0, 0)
  private var hasDragged = false

  override fun onTouch(view: View, event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        onDragStarted()
        downRawX = event.rawX
        downRawY = event.rawY
        startPosition = currentPosition()
        hasDragged = false
        return true
      }

      MotionEvent.ACTION_MOVE -> {
        val deltaX = event.rawX - downRawX
        val deltaY = event.rawY - downRawY
        if (abs(deltaX) > touchSlop || abs(deltaY) > touchSlop) {
          hasDragged = true
        }
        if (hasDragged) {
          val nextPosition = OverlayGeometry.constrainVisible(
            OverlayPosition(
              x = (startPosition.x + deltaX).toInt(),
              y = (startPosition.y + deltaY).toInt(),
            ),
            overlaySize,
            availableBounds(),
          )
          onPositionChanged(nextPosition)
        }
        return true
      }

      MotionEvent.ACTION_UP -> {
        if (hasDragged) {
          onDragFinished(resolveDragRelease())
        } else {
          view.performClick()
        }
        return true
      }

      MotionEvent.ACTION_CANCEL -> {
        if (hasDragged) {
          onDragFinished(resolveDragRelease())
        }
        return true
      }
    }
    return false
  }

  private fun resolveDragRelease(): OverlayDragRelease {
    return OverlayGeometry.resolveDragRelease(
      position = currentPosition(),
      size = overlaySize,
      bounds = availableBounds(),
      edgeSnapConfig = edgeSnapConfig,
    )
  }
}
