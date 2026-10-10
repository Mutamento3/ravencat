package expo.modules.ravencatfloatinglayer.controller

import org.junit.Assert.assertFalse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RavenCatOverlayVisibilityPolicyTest {
  @Test
  fun `call suppression composes with foreground and capture without early restore`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    policy.acquire(RavenCatOverlaySuppressionReason.EXCLUSIVE_INTERACTION)
    policy.acquire(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    policy.release(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    assertFalse(policy.shouldShow)
    policy.setAppForeground(true)
    policy.release(RavenCatOverlaySuppressionReason.EXCLUSIVE_INTERACTION)
    assertFalse(policy.shouldShow)
    policy.setAppForeground(false)
    assertTrue(policy.shouldShow)
  }

  @Test
  fun `unknown foreground state is fail closed until explicit background`() {
    val policy = RavenCatOverlayVisibilityPolicy()

    assertFalse(policy.shouldShow)

    policy.setAppForeground(true)
    assertFalse(policy.shouldShow)

    policy.setAppForeground(false)
    assertTrue(policy.shouldShow)
  }

  @Test
  fun `foreground and screen capture reasons compose without premature restore`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    assertTrue(policy.shouldShow)

    policy.acquire(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    policy.setAppForeground(true)
    assertFalse(policy.shouldShow)

    policy.release(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    assertFalse(policy.shouldShow)
    assertTrue(policy.has(RavenCatOverlaySuppressionReason.APP_FOREGROUND_HOST))

    policy.setAppForeground(false)
    assertTrue(policy.shouldShow)
  }

  @Test
  fun `foreground hides both window modes and background restores bubble only`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)

    var bubbleState = RavenCatOverlayWindowState.BUBBLE
    policy.setAppForeground(true)
    bubbleState = RavenCatOverlayWindowStateReducer.reduce(
      bubbleState,
      RavenCatOverlayWindowEvent.HIDE,
    )
    assertEquals(RavenCatOverlayWindowState.HIDDEN, bubbleState)

    policy.setAppForeground(false)
    bubbleState = RavenCatOverlayWindowStateReducer.reduce(
      bubbleState,
      RavenCatOverlayWindowEvent.SHOW_BUBBLE,
    )
    assertEquals(RavenCatOverlayWindowState.BUBBLE, bubbleState)

    var panelState = RavenCatOverlayWindowState.PANEL
    policy.setAppForeground(true)
    panelState = RavenCatOverlayWindowStateReducer.reduce(
      panelState,
      RavenCatOverlayWindowEvent.HIDE,
    )
    assertEquals(RavenCatOverlayWindowState.HIDDEN, panelState)

    policy.setAppForeground(false)
    panelState = RavenCatOverlayWindowStateReducer.reduce(
      panelState,
      RavenCatOverlayWindowEvent.SHOW_BUBBLE,
    )
    assertEquals(RavenCatOverlayWindowState.BUBBLE, panelState)
  }

  @Test
  fun `duplicate acquire and release are idempotent`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    policy.acquire(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    policy.acquire(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    policy.release(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)

    assertTrue(policy.shouldShow)
    assertFalse(policy.hasAnySuppression())
  }

  @Test
  fun `native activity resume hides overlay even when host reports background`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    assertTrue(policy.shouldShow)

    policy.acquire(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)
    assertFalse("Host background + native Activity resumed 必须隐藏", policy.shouldShow)
  }

  @Test
  fun `native activity resume hides overlay when host bridge never reported`() {
    // JS 崩溃 / bridge 未执行：Host fact 仍是 unknown（初始 fail-closed），
    // native Activity resume 继续独立保持隐藏。
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.acquire(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)

    assertFalse(policy.shouldShow)
    policy.release(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)
    assertFalse("Host unknown 本身仍是 fail-closed", policy.shouldShow)
  }

  @Test
  fun `native background does not restore overlay while host still foreground`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(true)
    policy.acquire(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)

    policy.release(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)

    assertFalse("Host 仍认为前台时必须保持 fail-closed", policy.shouldShow)
    assertTrue(policy.has(RavenCatOverlaySuppressionReason.APP_FOREGROUND_HOST))
  }

  @Test
  fun `all background facts and no capture restore bubble visibility`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    policy.acquire(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)
    policy.release(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)

    assertTrue(policy.shouldShow)
  }

  @Test
  fun `releasing screen capture during native foreground stays hidden`() {
    val policy = RavenCatOverlayVisibilityPolicy()
    policy.setAppForeground(false)
    policy.acquire(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)
    policy.acquire(RavenCatOverlaySuppressionReason.APP_FOREGROUND_NATIVE_ACTIVITY)

    policy.release(RavenCatOverlaySuppressionReason.SCREEN_CAPTURE)

    assertFalse("SCREEN_CAPTURE 释放后 native 前台仍必须隐藏", policy.shouldShow)
  }
}
