package expo.modules.callruntime

import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ViewConfiguration
import android.widget.TextView
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@LooperMode(LooperMode.Mode.PAUSED)
class CallFloatingFrameTest {
  private val context = RuntimeEnvironment.getApplication()
  private var starts = 0
  private var returns = 0
  private val moves = mutableListOf<Pair<Float, Float>>()
  private val frame = CallFloatingFrame(context, { starts++ }, { x, y -> moves.add(x to y) }, { returns++ })
  private val time = SystemClock.uptimeMillis()

  private fun touch(action: Int, offset: Long, x: Float = 30f, y: Float = 30f) {
    val event = MotionEvent.obtain(time, time + offset, action, x, y, 0)
    frame.dispatchTouchEvent(event)
    event.recycle()
  }

  @Test
  fun `single tap and stationary hold do nothing`() {
    touch(MotionEvent.ACTION_DOWN, 0)
    touch(MotionEvent.ACTION_UP, 60)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    assertEquals(0, returns)
    assertEquals(0, starts)
    touch(MotionEvent.ACTION_DOWN, 1100)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    touch(MotionEvent.ACTION_UP, 2100)
    assertEquals(0, returns)
    assertEquals(0, starts)
  }

  @Test
  fun `double tap returns only after second finger release`() {
    touch(MotionEvent.ACTION_DOWN, 0)
    touch(MotionEvent.ACTION_UP, 60)
    touch(MotionEvent.ACTION_DOWN, 160)
    assertEquals(0, returns)
    touch(MotionEvent.ACTION_UP, 220)
    assertEquals(1, returns)
    assertEquals(0, starts)
  }

  @Test
  fun `movement starts dragging immediately anywhere on frame without child clicks`() {
    var clicks = 0
    frame.addView(TextView(context).apply { setOnClickListener { clicks++ } })
    val slop = ViewConfiguration.get(context).scaledTouchSlop.toFloat()
    touch(MotionEvent.ACTION_DOWN, 0)
    touch(MotionEvent.ACTION_MOVE, 10, 30f + slop / 2, 30f)
    assertEquals(0, starts)
    touch(MotionEvent.ACTION_MOVE, 20, 30f + slop * 2, 30f + slop * 3)
    touch(MotionEvent.ACTION_UP, 30)
    assertEquals(1, starts)
    assertEquals(listOf(slop * 2 to slop * 3), moves)
    assertEquals(0, returns)
    assertEquals(0, clicks)
  }

  @Test
  fun `second tap becoming a drag does not return to app`() {
    touch(MotionEvent.ACTION_DOWN, 0)
    touch(MotionEvent.ACTION_UP, 60)
    touch(MotionEvent.ACTION_DOWN, 160)
    touch(MotionEvent.ACTION_MOVE, 170, 100f, 100f)
    touch(MotionEvent.ACTION_UP, 190, 100f, 100f)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
    assertEquals(1, starts)
    assertEquals(0, returns)
  }
}
