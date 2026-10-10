package expo.modules.callruntime

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowSettings
import org.robolectric.shadows.ShadowWindowManagerImpl

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@LooperMode(LooperMode.Mode.PAUSED)
class CallOverlayContinuityTest {
  private lateinit var service: CallExecutionService
  private lateinit var window: ShadowWindowManagerImpl

  @Before
  fun setup() {
    ShadowSettings.setCanDrawOverlays(true)
    service = Robolectric.buildService(CallExecutionService::class.java).create().get()
    service.returnUri = Uri.parse("kimiphone:///calls/test-call")
    window = Shadow.extract(service.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
  }

  @After
  fun cleanup() {
    service.overlay.close()
    service.camera.close()
  }

  private fun drag(view: View, dx: Float, dy: Float) {
    val time = SystemClock.uptimeMillis()
    listOf(
      MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, 30f, 50f, 0),
      MotionEvent.obtain(time, time + 10, MotionEvent.ACTION_MOVE, 30f + dx, 50f + dy, 0),
      MotionEvent.obtain(time, time + 20, MotionEvent.ACTION_UP, 30f + dx, 50f + dy, 0),
    ).forEach { event -> view.dispatchTouchEvent(event); event.recycle() }
  }

  @Test
  fun `camera window and position survive page and foreground transitions`() {
    service.overlay.setCameraEnabled(true)
    val frame = window.views.single()
    drag(frame, -40f, 90f)
    val layout = frame.layoutParams as WindowManager.LayoutParams
    val position = layout.x to layout.y
    repeat(3) {
      service.overlay.setFullScreen(false)
      service.overlay.setAppVisible(false)
      service.overlay.setFullScreen(true)
      service.overlay.setAppVisible(true)
      assertSame(frame, window.views.single())
      val next = frame.layoutParams as WindowManager.LayoutParams
      assertEquals(position, next.x to next.y)
    }
  }

  @Test
  fun `window can move to top left edge and avatar changes in the same background frame`() {
    service.overlay.setFullScreen(false)
    val frame = window.views.single()
    service.overlay.setCameraEnabled(true)
    assertSame(frame, window.views.single())
    drag(frame, -10000f, -10000f)
    val layout = frame.layoutParams as WindowManager.LayoutParams
    assertEquals(0, layout.x)
    assertEquals(0, layout.y)
    service.overlay.setCameraEnabled(false)
    assertSame(frame, window.views.single())
    service.overlay.setFullScreen(true)
    assertTrue(window.views.isEmpty())
  }
}
