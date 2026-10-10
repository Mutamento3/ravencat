package expo.modules.devicecontrol.controller

import android.media.session.PlaybackState
import expo.modules.devicecontrol.model.MediaSessionActionsSnapshot
import expo.modules.devicecontrol.model.MediaSessionSnapshotResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MediaSessionSnapshotReaderTest {
  private fun source(packageName: String, title: String): MediaSessionControllerSource =
    FakeMediaSessionControllerSource(packageName, title = title)

  private fun reader(
    controllers: List<MediaSessionControllerSource>,
    granted: Boolean = true,
  ): MediaSessionSnapshotReader = MediaSessionSnapshotReader(
    loadControllers = { controllers },
    accessReader = NotificationListenerAccessReader { granted },
  )

  @Test
  fun `select 只返回 exact package 对应的 controller`() {
    val result = reader(
      listOf(
        source("com.spotify.music", "Spotify"),
        source("com.netease.cloudmusic", "NetEase"),
        source("com.example.other", "Other"),
      ),
    ).read("com.netease.cloudmusic") as MediaSessionSnapshotResult.Available

    assertEquals("com.netease.cloudmusic", result.snapshot.packageName)
    assertEquals("NetEase", result.snapshot.metadata.title)
  }

  @Test
  fun `目标 package 不存在返回 no active session`() {
    val result = reader(listOf(source("com.spotify.music", "Spotify")))
      .read("com.netease.cloudmusic") as MediaSessionSnapshotResult.NoActiveSession

    assertEquals("com.netease.cloudmusic", result.packageName)
  }

  @Test
  fun `permission missing 不会查询 session`() {
    var queried = false
    val reader = MediaSessionSnapshotReader(
      loadControllers = {
        queried = true
        emptyList()
      },
      accessReader = NotificationListenerAccessReader { false },
    )

    assertTrue(reader.read("com.example.music") is MediaSessionSnapshotResult.PermissionNotGranted)
    assertFalse(queried)
  }

  @Test
  fun `平台失败保留为 snapshot failed`() {
    val reader = MediaSessionSnapshotReader(
      loadControllers = { error("system query failed") },
      accessReader = NotificationListenerAccessReader { true },
    )

    val result = reader.read("com.example.music") as MediaSessionSnapshotResult.Failed
    assertEquals("system query failed", result.reason)
  }

  @Test
  fun `playback state 显式 normalize`() {
    assertEquals("playing", normalizePlaybackState(PlaybackState.STATE_PLAYING))
    assertEquals("paused", normalizePlaybackState(PlaybackState.STATE_PAUSED))
    assertEquals("buffering", normalizePlaybackState(PlaybackState.STATE_BUFFERING))
    assertEquals("stopped", normalizePlaybackState(PlaybackState.STATE_STOPPED))
    assertEquals("unknown", normalizePlaybackState(Int.MAX_VALUE))
  }

  @Test
  fun `metadata 可完整 缺字段 或整体为空`() {
    val playback = RawPlaybackState(PlaybackState.STATE_PLAYING, 120L, 1f, 900L, 0L)
    val complete = createMediaSessionSnapshot(
      "com.example.music",
      playback,
      RawMediaMetadata("id", "title", "artist", "album", 3000L),
      nowEpochMs = 10_000L,
      nowElapsedRealtimeMs = 1_000L,
    )
    assertEquals("id", complete.metadata.mediaId)
    assertEquals(3000L, complete.metadata.durationMs)
    assertEquals(9900L, complete.playback.updatedAtEpochMs)

    val partial = createMediaSessionSnapshot(
      "com.example.music",
      playback,
      RawMediaMetadata(null, "title", null, null, null),
      10_000L,
      1_000L,
    )
    assertEquals("title", partial.metadata.title)
    assertNull(partial.metadata.artist)
    assertNull(partial.metadata.durationMs)

    val empty = createMediaSessionSnapshot(
      "com.example.music",
      playback,
      null,
      10_000L,
      1_000L,
    )
    assertNull(empty.metadata.title)
    assertEquals("playing", empty.playback.state)
  }

  @Test
  fun `actions bitmask 映射各稳定字段`() {
    val actions = actionsSnapshot(
      PlaybackState.ACTION_PLAY or
        PlaybackState.ACTION_PAUSE or
        PlaybackState.ACTION_PLAY_PAUSE or
        PlaybackState.ACTION_SKIP_TO_NEXT or
        PlaybackState.ACTION_SKIP_TO_PREVIOUS or
        PlaybackState.ACTION_SEEK_TO,
    )

    assertTrue(actions.play)
    assertTrue(actions.pause)
    assertTrue(actions.playPause)
    assertTrue(actions.next)
    assertTrue(actions.previous)
    assertTrue(actions.seekTo)
    assertFalse(actions.stop)
  }

  @Test
  fun `扩展 advertised actions 各 flag 独立映射`() {
    val expected = listOf(
      PlaybackState.ACTION_PLAY_FROM_MEDIA_ID to { actions: MediaSessionActionsSnapshot ->
        actions.playFromMediaId
      },
      PlaybackState.ACTION_PLAY_FROM_SEARCH to { actions: MediaSessionActionsSnapshot ->
        actions.playFromSearch
      },
      PlaybackState.ACTION_PLAY_FROM_URI to { actions: MediaSessionActionsSnapshot ->
        actions.playFromUri
      },
      PlaybackState.ACTION_PREPARE to { actions: MediaSessionActionsSnapshot -> actions.prepare },
      PlaybackState.ACTION_PREPARE_FROM_MEDIA_ID to { actions: MediaSessionActionsSnapshot ->
        actions.prepareFromMediaId
      },
      PlaybackState.ACTION_PREPARE_FROM_SEARCH to { actions: MediaSessionActionsSnapshot ->
        actions.prepareFromSearch
      },
      PlaybackState.ACTION_PREPARE_FROM_URI to { actions: MediaSessionActionsSnapshot ->
        actions.prepareFromUri
      },
    )

    for ((action, readFlag) in expected) {
      val snapshot = actionsSnapshot(action)
      assertTrue(readFlag(snapshot))
      assertEquals(1, expected.count { (_, readOtherFlag) -> readOtherFlag(snapshot) })
    }
  }

  @Test
  fun `exact package input trim 后校验 wildcard list 与长度`() {
    val reader = MediaSessionSnapshotReader(
      loadControllers = { emptyList() },
      accessReader = NotificationListenerAccessReader { true },
    )
    val trimmed = reader.read("  com.example.music  ") as MediaSessionSnapshotResult.NoActiveSession
    assertEquals("com.example.music", trimmed.packageName)
    assertTrue(reader.read("com.example.*") is MediaSessionSnapshotResult.InvalidPackageName)
    assertTrue(reader.read("com.a,com.b") is MediaSessionSnapshotResult.InvalidPackageName)
    assertTrue(reader.read("x".repeat(256)) is MediaSessionSnapshotResult.InvalidPackageName)
  }
}
