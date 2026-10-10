package expo.modules.ravencatfloatinglayer.controller

import android.graphics.Rect
import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class RavenCatPanelWindowGeometryPolicyTest {
  private val screen = Rect(0, 0, 1080, 2400)
  private val metricsAvailable = Rect(0, 96, 1080, 2280)

  @Test
  fun `Together ignores alternating panel-local insets and updates only once`() {
    val localInsetsA = Rect(0, 0, 1080, 2280)
    val localInsetsB = Rect(0, 96, 1080, 2184)
    val state = RavenCatPanelWindowGeometryState()
    var updateCount = 0

    listOf(localInsetsA, localInsetsB, localInsetsA, localInsetsB).forEach { localInsets ->
      val layout = resolve(RavenCatPanelPage.TOGETHER, localInsets)
      state.applyIfChanged(layout.geometry) { updateCount += 1 }

      assertEquals(0, layout.contentTopInset)
      assertEquals(90, layout.geometry.x)
      assertEquals(132, layout.geometry.y)
      assertEquals(900, layout.geometry.width)
      assertEquals(252, layout.geometry.height)
    }

    assertEquals(1, updateCount)
  }

  @Test
  fun `repeated Together content refresh cannot reapply equal geometry`() {
    val state = RavenCatPanelWindowGeometryState()
    val geometry = resolve(RavenCatPanelPage.TOGETHER, Rect(0, 0, 1080, 2400)).geometry
    var updateCount = 0

    repeat(60) {
      state.applyIfChanged(geometry) { updateCount += 1 }
    }

    assertEquals(1, updateCount)
  }

  @Test
  fun `each actual page switch applies exactly one new geometry`() {
    val state = RavenCatPanelWindowGeometryState()
    val together = resolve(RavenCatPanelPage.TOGETHER, Rect(0, 0, 1080, 2400)).geometry
    val chat = resolve(RavenCatPanelPage.CHAT, metricsAvailable).geometry
    var updateCount = 0

    assertTrue(state.applyIfChanged(together) { updateCount += 1 })
    assertTrue(state.applyIfChanged(chat) { updateCount += 1 })
    assertFalse(state.applyIfChanged(chat) { updateCount += 1 })
    assertTrue(state.applyIfChanged(together) { updateCount += 1 })

    assertEquals(3, updateCount)
  }

  @Test
  fun `failed WindowManager update does not advance applied geometry`() {
    val state = RavenCatPanelWindowGeometryState()
    val geometry = resolve(RavenCatPanelPage.TOGETHER, metricsAvailable).geometry

    runCatching {
      state.applyIfChanged(geometry) { error("update failed") }
    }

    assertEquals(null, state.lastApplied)
  }

  @Test
  fun `synchronous inset reentry cannot apply the same geometry twice`() {
    val state = RavenCatPanelWindowGeometryState()
    val geometry = resolve(RavenCatPanelPage.TOGETHER, metricsAvailable).geometry
    var updateCount = 0

    state.applyIfChanged(geometry) {
      updateCount += 1
      state.applyIfChanged(geometry) { updateCount += 1 }
    }

    assertEquals(1, updateCount)
    assertEquals(geometry, state.lastApplied)
  }

  private fun resolve(page: RavenCatPanelPage, viewInsetsAvailable: Rect) =
    RavenCatPanelWindowGeometryPolicy.resolve(
      page = page,
      screen = screen,
      metricsAvailable = metricsAvailable,
      viewInsetsAvailable = viewInsetsAvailable,
      density = 3f,
    )
}
