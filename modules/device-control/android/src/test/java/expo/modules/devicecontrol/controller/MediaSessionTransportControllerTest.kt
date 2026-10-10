package expo.modules.devicecontrol.controller

import android.media.session.PlaybackState
import expo.modules.devicecontrol.model.MediaSessionTransportCommand
import expo.modules.devicecontrol.model.MediaSessionTransportResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaSessionTransportControllerTest {
  /** spotify / netease / other 三选一：只能命中 netease，其余 transport 调用次数必须为 0。 */
  private data class Sessions(
    val spotify: FakeMediaSessionControllerSource,
    val netease: FakeMediaSessionControllerSource,
    val other: FakeMediaSessionControllerSource,
  )

  private fun threeSessions(
    neteaseActions: Long,
    neteaseDispatchError: String? = null,
  ): Sessions = Sessions(
    FakeMediaSessionControllerSource("com.spotify.music", actions = 0L),
    FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = neteaseActions,
      dispatchError = neteaseDispatchError,
    ),
    FakeMediaSessionControllerSource("com.example.other", actions = 0L),
  )

  private fun controller(
    controllers: List<MediaSessionControllerSource>,
  ): MediaSessionTransportController = MediaSessionTransportController(
    loadControllers = { controllers },
    accessReader = NotificationListenerAccessReader { true },
  )

  @Test
  fun `exact package 只命中目标 controller 其余 transport 调用为 0`() {
    val (spotify, netease, other) = threeSessions(
      PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY or
        PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS,
    )

    val result = controller(listOf(spotify, netease, other))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.CommandDispatched

    assertEquals("com.netease.cloudmusic", result.packageName)
    assertEquals(MediaSessionTransportCommand.PAUSE, result.command)
    assertEquals(listOf(MediaSessionTransportCommand.PAUSE), netease.dispatchedCommands)
    assertTrue(spotify.dispatchedCommands.isEmpty())
    assertTrue(other.dispatchedCommands.isEmpty())
  }

  @Test
  fun `pause 有 ACTION_PAUSE 时只调用一次 pause`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PAUSE,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.CommandDispatched

    assertEquals(MediaSessionTransportCommand.PAUSE, result.command)
    assertEquals(1, netease.dispatchedCommands.size)
    assertEquals(MediaSessionTransportCommand.PAUSE, netease.dispatchedCommands.single())
  }

  @Test
  fun `pause 没有 ACTION_PAUSE 时 action not supported 且零 dispatch`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PLAY,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.ActionNotSupported

    assertEquals("com.netease.cloudmusic", result.packageName)
    assertEquals(MediaSessionTransportCommand.PAUSE, result.command)
    assertTrue(netease.dispatchedCommands.isEmpty())
  }

  @Test
  fun `resume 有 ACTION_PLAY 时只调用一次 play`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PLAY,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "resume") as MediaSessionTransportResult.CommandDispatched

    assertEquals(MediaSessionTransportCommand.RESUME, result.command)
    assertEquals(MediaSessionTransportCommand.RESUME, netease.dispatchedCommands.single())
  }

  /** playPause=true 不能替代 ACTION_PLAY。 */
  @Test
  fun `resume 只有 ACTION_PLAY_PAUSE 时 action not supported`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PLAY_PAUSE,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "resume") as MediaSessionTransportResult.ActionNotSupported

    assertEquals(MediaSessionTransportCommand.RESUME, result.command)
    assertTrue(netease.dispatchedCommands.isEmpty())
  }

  @Test
  fun `pause 只有 ACTION_PLAY_PAUSE 时 action not supported`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PLAY_PAUSE,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.ActionNotSupported

    assertEquals(MediaSessionTransportCommand.PAUSE, result.command)
    assertTrue(netease.dispatchedCommands.isEmpty())
  }

  @Test
  fun `next 需要 ACTION_SKIP_TO_NEXT`() {
    val supported = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_SKIP_TO_NEXT,
    )
    val result = controller(listOf(supported))
      .dispatch("com.netease.cloudmusic", "next") as MediaSessionTransportResult.CommandDispatched
    assertEquals(MediaSessionTransportCommand.NEXT, result.command)
    assertEquals(MediaSessionTransportCommand.NEXT, supported.dispatchedCommands.single())

    val unsupported = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_SKIP_TO_PREVIOUS,
    )
    assertTrue(
      controller(listOf(unsupported))
        .dispatch("com.netease.cloudmusic", "next")
        is MediaSessionTransportResult.ActionNotSupported,
    )
    assertTrue(unsupported.dispatchedCommands.isEmpty())
  }

  @Test
  fun `previous 需要 ACTION_SKIP_TO_PREVIOUS`() {
    val supported = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_SKIP_TO_PREVIOUS,
    )
    val result = controller(listOf(supported))
      .dispatch("com.netease.cloudmusic", "previous")
      as MediaSessionTransportResult.CommandDispatched
    assertEquals(MediaSessionTransportCommand.PREVIOUS, result.command)
    assertEquals(MediaSessionTransportCommand.PREVIOUS, supported.dispatchedCommands.single())

    val unsupported = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_SKIP_TO_NEXT,
    )
    assertTrue(
      controller(listOf(unsupported))
        .dispatch("com.netease.cloudmusic", "previous")
        is MediaSessionTransportResult.ActionNotSupported,
    )
    assertTrue(unsupported.dispatchedCommands.isEmpty())
  }

  /** 当前 playback state 不参与 admission：只认 advertised action bit。 */
  @Test
  fun `admission 不读取 playback state`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PAUSE,
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "pause")

    assertTrue(result is MediaSessionTransportResult.CommandDispatched)
    assertEquals(0, netease.snapshotCalls)
  }

  @Test
  fun `permission not granted 时不查询 session 也不 dispatch`() {
    var queried = false
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PAUSE,
    )

    val result = MediaSessionTransportController(
      loadControllers = {
        queried = true
        listOf(netease)
      },
      accessReader = NotificationListenerAccessReader { false },
    ).dispatch("com.netease.cloudmusic", "pause")

    assertSame(MediaSessionTransportResult.PermissionNotGranted, result)
    assertFalse(queried)
    assertTrue(netease.dispatchedCommands.isEmpty())
  }

  @Test
  fun `exact target 不存在时 no active session 且零 dispatch`() {
    val (spotify, _, other) = threeSessions(PlaybackState.ACTION_PAUSE)

    val result = controller(listOf(spotify, other))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.NoActiveSession

    assertEquals("com.netease.cloudmusic", result.packageName)
    assertTrue(spotify.dispatchedCommands.isEmpty())
    assertTrue(other.dispatchedCommands.isEmpty())
  }

  @Test
  fun `transport 抛异常时保留 dispatch failed 不伪装成功`() {
    val (_, netease, _) = threeSessions(
      PlaybackState.ACTION_PAUSE,
      neteaseDispatchError = "transport broke",
    )

    val result = controller(listOf(netease))
      .dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.DispatchFailed

    assertEquals("com.netease.cloudmusic", result.packageName)
    assertEquals(MediaSessionTransportCommand.PAUSE, result.command)
    assertEquals("transport broke", result.reason)
  }

  /** 授权在 discovery 时被系统撤销：保留真实 failure，不伪装成 no_active_session。 */
  @Test
  fun `discovery 抛出 SecurityException 时保留 dispatch failed`() {
    val result = MediaSessionTransportController(
      loadControllers = { error("SecurityException: listener revoked") },
      accessReader = NotificationListenerAccessReader { true },
    ).dispatch("com.netease.cloudmusic", "pause") as MediaSessionTransportResult.DispatchFailed

    assertEquals("SecurityException: listener revoked", result.reason)
  }

  @Test
  fun `未知 command 一律 invalid command 不 silent fallback`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY,
    )
    val transport = controller(listOf(netease))

    for (unknown in listOf("play", "stop", "seek", "PAUSE", "")) {
      val result = transport.dispatch("com.netease.cloudmusic", unknown)
        as MediaSessionTransportResult.InvalidCommand
      assertTrue(result.reason.isNotEmpty())
    }
    assertTrue(netease.dispatchedCommands.isEmpty())
  }

  @Test
  fun `exact package 校验复用 observation 规则`() {
    val netease = FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = PlaybackState.ACTION_PAUSE,
    )
    val transport = controller(listOf(netease))

    val trimmed = transport.dispatch("  com.netease.cloudmusic  ", "pause")
      as MediaSessionTransportResult.CommandDispatched
    assertEquals("com.netease.cloudmusic", trimmed.packageName)
    assertTrue(transport.dispatch("com.example.*", "pause")
      is MediaSessionTransportResult.InvalidPackageName)
    assertTrue(transport.dispatch("com.a,com.b", "pause")
      is MediaSessionTransportResult.InvalidPackageName)
    assertTrue(transport.dispatch("x".repeat(256), "pause")
      is MediaSessionTransportResult.InvalidPackageName)
  }

  @Test
  fun `command 枚举只暴露四个 wire name`() {
    assertEquals(
      listOf("pause", "resume", "next", "previous"),
      MediaSessionTransportCommand.entries.map { it.wireName },
    )
  }

  @Test
  fun `每个 command 绑定唯一 action bit`() {
    val expected = mapOf(
      MediaSessionTransportCommand.PAUSE to PlaybackState.ACTION_PAUSE,
      MediaSessionTransportCommand.RESUME to PlaybackState.ACTION_PLAY,
      MediaSessionTransportCommand.NEXT to PlaybackState.ACTION_SKIP_TO_NEXT,
      MediaSessionTransportCommand.PREVIOUS to PlaybackState.ACTION_SKIP_TO_PREVIOUS,
    )
    assertEquals(expected.keys, MediaSessionTransportCommand.entries.toSet())
    for ((command, bit) in expected) {
      assertEquals(bit, command.actionBit)
    }
  }
}
