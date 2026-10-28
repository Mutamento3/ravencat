package expo.modules.callruntime

import android.content.Context
import android.app.Activity
import android.net.Uri
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import expo.modules.androidoverlayruntime.CallPresentationReturn
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowSettings
import org.robolectric.shadows.ShadowWindowManagerImpl
import java.time.Duration

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
    service.callId = "test-call"
    service.returnUri = Uri.parse("kimiphone:///calls/test-call")
    window = Shadow.extract(service.getSystemService(Context.WINDOW_SERVICE) as WindowManager)
  }

  @After
  fun cleanup() {
    service.overlay.close()
    service.camera.close()
    CallPresentationReturn.leave(service.callId, null)
  }

  private fun drag(view: View, dx: Float, dy: Float) {
    val time = SystemClock.uptimeMillis()
    listOf(
      MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, 30f, 50f, 0),
      MotionEvent.obtain(time, time + 10, MotionEvent.ACTION_MOVE, 30f + dx, 50f + dy, 0),
      MotionEvent.obtain(time, time + 20, MotionEvent.ACTION_UP, 30f + dx, 50f + dy, 0),
    ).forEach { event -> view.dispatchTouchEvent(event); event.recycle() }
  }

  private fun layout(view: View) {
    val params = view.layoutParams as WindowManager.LayoutParams
    view.measure(View.MeasureSpec.makeMeasureSpec(params.width, View.MeasureSpec.EXACTLY),
      View.MeasureSpec.makeMeasureSpec(params.height, View.MeasureSpec.EXACTLY))
    view.layout(0, 0, params.width, params.height)
  }

  private fun doubleTap(view: View) {
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(300))
    val time = SystemClock.uptimeMillis()
    listOf(MotionEvent.ACTION_DOWN to 0L, MotionEvent.ACTION_UP to 60L,
      MotionEvent.ACTION_DOWN to 160L, MotionEvent.ACTION_UP to 220L).forEach { (action, offset) ->
      val event = MotionEvent.obtain(time, time + offset, action, 30f, 50f, 0)
      view.dispatchTouchEvent(event)
      event.recycle()
    }
  }

  private fun geometry(view: View): List<Int> {
    val params = view.layoutParams as WindowManager.LayoutParams
    return listOf(params.x, params.y, params.width, params.height)
  }

  private fun preview(view: View): PreviewView? {
    if (view is PreviewView) return view
    if (view is ViewGroup) for (index in 0 until view.childCount) {
      preview(view.getChildAt(index))?.let { return it }
    }
    return null
  }

  class TaskActivity : Activity() {
    var backgroundCount = 0
    override fun moveTaskToBack(nonRoot: Boolean): Boolean { backgroundCount++; return true }
  }

  @Test
  fun `permission pause keeps the full screen call visible without flashing an avatar window`() {
    val activity = Robolectric.buildActivity(TaskActivity::class.java).create().start().resume()
    val main = activity.get()
    CallPresentationReturn.started(main)
    val unsubscribe = CallPresentationReturn.subscribeAppVisibility(service.overlay::setAppVisible)
    try {
      assertTrue(window.views.isEmpty())
      // 系统权限窗口只 Pause 主界面，实际主界面尚未 Stop，不能据此创建后台小窗。
      activity.pause()
      assertTrue(CallPresentationReturn.isAppVisible)
      assertTrue(window.views.isEmpty())
      activity.resume()
      assertTrue(window.views.isEmpty())
      activity.pause().stop()
      CallPresentationReturn.stopped(main)
      assertEquals(1, window.views.size)
      activity.start()
      CallPresentationReturn.started(main)
      assertTrue(window.views.isEmpty())
    } finally {
      unsubscribe()
      CallPresentationReturn.stopped(main)
      activity.stop().destroy()
    }
  }

  @Test
  fun `app visibility tracks all started activities and releases its subscription`() {
    val first = Robolectric.buildActivity(TaskActivity::class.java).get()
    val second = Robolectric.buildActivity(TaskActivity::class.java).get()
    val states = mutableListOf<Boolean>()
    val unsubscribe = CallPresentationReturn.subscribeAppVisibility { states.add(it) }
    try {
      CallPresentationReturn.started(first)
      CallPresentationReturn.started(first)
      CallPresentationReturn.started(second)
      CallPresentationReturn.stopped(first)
      CallPresentationReturn.stopped(first)
      assertTrue(CallPresentationReturn.isAppVisible)
      CallPresentationReturn.stopped(second)
      assertEquals(listOf(false, true, false), states)
      unsubscribe()
      CallPresentationReturn.started(first)
      assertEquals(listOf(false, true, false), states)
    } finally {
      unsubscribe()
      CallPresentationReturn.stopped(first)
      CallPresentationReturn.stopped(second)
    }
  }

  @Test
  fun `overlay records the current app visibility on every restoration`() {
    val activity = Robolectric.buildActivity(TaskActivity::class.java).get()
    service.overlay.setCameraEnabled(true)
    service.overlay.setAppVisible(false)
    val frame = window.views.single()
    layout(frame)
    doubleTap(frame)
    CallPresentationReturn.leave(service.callId, activity)
    assertEquals(1, activity.backgroundCount)
    service.overlay.setAppVisible(true)
    service.overlay.setFullScreen(false)
    CallPresentationReturn.started(activity)
    try {
      doubleTap(frame)
      CallPresentationReturn.leave(service.callId, activity)
      assertEquals(1, activity.backgroundCount)
    } finally { CallPresentationReturn.stopped(activity) }
  }

  @Test
  fun `camera window geometry and preview stay unchanged throughout page fade and handoff`() {
    service.overlay.setCameraEnabled(true)
    service.overlay.setFullScreen(false)
    val frame = window.views.single()
    drag(frame, -40f, 90f)
    layout(frame)
    val original = geometry(frame)
    val camera = checkNotNull(preview(frame))
    val cameraSize = camera.width to camera.height
    doubleTap(frame)
    val request = checkNotNull(service.overlay.pendingPresentation)
    service.overlay.setFullScreen(true)
    val page = View(service)
    service.overlay.attachPresentation(page)
    listOf(0f, 0.25f, 0.5f, 0.75f, 1f).forEach { progress ->
      service.overlay.setPresentationProgress(page, request, progress)
      assertSame(frame, window.views.single())
      assertEquals(original, geometry(frame))
      assertEquals(1f, frame.alpha, 0f)
      assertSame(camera, preview(frame))
      assertEquals(cameraSize, camera.width to camera.height)
    }
    service.overlay.completeRestore(page, request)
    assertSame(frame, window.views.single())
    assertSame(camera, preview(frame))
    assertEquals(original, geometry(frame))
    assertNull(service.overlay.pendingPresentation)
  }

  @Test
  fun `avatar survives route activation until the ready page has drawn its first live frame`() {
    service.overlay.setAppVisible(false)
    val frame = window.views.single()
    layout(frame)
    val original = geometry(frame)
    doubleTap(frame)
    service.overlay.setAppVisible(true)
    service.overlay.setFullScreen(true)
    assertSame(frame, window.views.single())
    val request = checkNotNull(service.overlay.pendingPresentation)
    val page = View(service)
    service.overlay.attachPresentation(page)
    listOf(0f, 0.5f, 1f).forEach { progress ->
      service.overlay.setPresentationProgress(page, request, progress)
      assertSame(frame, window.views.single())
      assertEquals(original, geometry(frame))
      assertEquals(1f - progress, frame.alpha, 0f)
    }
    service.overlay.completeRestore(View(service), request)
    assertSame(frame, window.views.single())
    service.overlay.completeRestore(page, request)
    assertTrue(window.views.isEmpty())
  }

  @Test
  fun `backgrounding cancels the fade and late frames cannot affect the next restoration`() {
    service.overlay.setFullScreen(false)
    val frame = window.views.single()
    layout(frame)
    val original = geometry(frame)
    doubleTap(frame)
    service.overlay.setFullScreen(true)
    val page = View(service)
    service.overlay.attachPresentation(page)
    val request = checkNotNull(service.overlay.pendingPresentation)
    service.overlay.setPresentationProgress(page, request, 0.5f)
    service.overlay.setAppVisible(false)
    service.overlay.setPresentationProgress(page, request, 1f)
    service.overlay.completeRestore(page, request)
    assertSame(frame, window.views.single())
    assertEquals(original, geometry(frame))
    assertEquals(1f, frame.alpha, 0f)
    assertNull(service.overlay.pendingPresentation)
    layout(frame)
    doubleTap(frame)
    service.overlay.setAppVisible(true)
    val next = checkNotNull(service.overlay.pendingPresentation)
    service.overlay.setPresentationProgress(page, next, 0.5f)
    service.overlay.setPresentationProgress(page, request, 1f)
    service.overlay.completeRestore(page, request)
    assertSame(frame, window.views.single())
    assertEquals(0.5f, frame.alpha, 0f)
    service.overlay.setPresentationProgress(page, next, 1f)
    service.overlay.completeRestore(page, next)
    assertTrue(window.views.isEmpty())
  }

  @Test
  fun `leaving a page before its background is ready cancels the pending restoration`() {
    service.overlay.setFullScreen(false)
    val frame = window.views.single()
    layout(frame)
    doubleTap(frame)
    val page = View(service)
    service.overlay.attachPresentation(page)
    service.overlay.presentationDetached(page)
    assertNull(service.overlay.pendingPresentation)
    assertSame(frame, window.views.single())
  }

  @Test
  fun `losing overlay permission during handoff removes the window without late resurrection`() {
    service.overlay.setFullScreen(false)
    val frame = window.views.single()
    layout(frame)
    doubleTap(frame)
    val page = View(service)
    service.overlay.attachPresentation(page)
    val request = checkNotNull(service.overlay.pendingPresentation)
    service.overlay.setPresentationProgress(page, request, 0.5f)
    ShadowSettings.setCanDrawOverlays(false)
    service.overlay.setAppVisible(true)
    assertTrue(window.views.isEmpty())
    service.overlay.setPresentationProgress(page, request, 1f)
    service.overlay.completeRestore(page, request)
    service.overlay.close()
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(400))
    assertTrue(window.views.isEmpty())
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
