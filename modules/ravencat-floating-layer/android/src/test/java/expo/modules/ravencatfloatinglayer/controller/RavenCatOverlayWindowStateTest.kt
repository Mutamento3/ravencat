package expo.modules.ravencatfloatinglayer.controller

import expo.modules.ravencatfloatinglayer.model.RavenCatPanelPage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatOverlayWindowStateTest {
  @Test
  fun `bubble panel transitions are finite and deterministic`() {
    var state = RavenCatOverlayWindowState.BUBBLE
    state = RavenCatOverlayWindowStateReducer.reduce(state, RavenCatOverlayWindowEvent.EXPAND)
    assertEquals(RavenCatOverlayWindowState.PANEL, state)

    state = RavenCatOverlayWindowStateReducer.reduce(state, RavenCatOverlayWindowEvent.EXPAND)
    assertEquals(RavenCatOverlayWindowState.PANEL, state)

    state = RavenCatOverlayWindowStateReducer.reduce(state, RavenCatOverlayWindowEvent.COLLAPSE)
    assertEquals(RavenCatOverlayWindowState.BUBBLE, state)

    state = RavenCatOverlayWindowStateReducer.reduce(state, RavenCatOverlayWindowEvent.HIDE)
    assertEquals(RavenCatOverlayWindowState.HIDDEN, state)

    state = RavenCatOverlayWindowStateReducer.reduce(state, RavenCatOverlayWindowEvent.SHOW_BUBBLE)
    assertEquals(RavenCatOverlayWindowState.BUBBLE, state)
  }

  @Test
  fun `active together projection never expands bubble`() {
    assertFalse(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = false,
        nextTogetherActive = true,
        state = RavenCatOverlayWindowState.BUBBLE,
        currentPage = RavenCatPanelPage.CHAT,
      ),
    )
    assertEquals(
      RavenCatOverlayWindowState.BUBBLE,
      RavenCatOverlayWindowStateReducer.reduce(
        RavenCatOverlayWindowState.BUBBLE,
        RavenCatOverlayWindowEvent.SHOW_BUBBLE,
      ),
    )
  }

  @Test
  fun `ended together panel collapses while bubble remains bubble`() {
    assertTrue(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = true,
        nextTogetherActive = false,
        state = RavenCatOverlayWindowState.PANEL,
        currentPage = RavenCatPanelPage.TOGETHER,
      ),
    )
    assertFalse(
      RavenCatTogetherPanelTransitionPolicy.shouldCollapse(
        previousTogetherActive = true,
        nextTogetherActive = false,
        state = RavenCatOverlayWindowState.BUBBLE,
        currentPage = RavenCatPanelPage.TOGETHER,
      ),
    )
  }
}
