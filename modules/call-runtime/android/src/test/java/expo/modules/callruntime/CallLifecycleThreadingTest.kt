package expo.modules.callruntime

import android.os.Looper
import androidx.camera.core.Preview
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@LooperMode(LooperMode.Mode.PAUSED)
class CallLifecycleThreadingTest {
  @Test
  fun `React background destroy can clear CameraX surface on main thread`() {
    val preview = Preview.Builder().build()
    var finished = false
    val background = Thread {
      dispatchCallLifecycle {
        assertTrue(Looper.myLooper() == Looper.getMainLooper())
        // 直接调用曾在真机销毁链上抛错的 CameraX API，不能用替身略过线程契约。
        preview.setSurfaceProvider(null)
        finished = true
      }
    }
    background.start()
    background.join()
    assertFalse(finished)
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(finished)
  }

  @Test
  fun `module scope cancellation does not cancel queued native cleanup`() {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    var released = false
    val background = Thread { dispatchCallLifecycle { released = true } }
    background.start()
    background.join()
    scope.cancel()
    shadowOf(Looper.getMainLooper()).idle()
    assertTrue(released)
  }
}
