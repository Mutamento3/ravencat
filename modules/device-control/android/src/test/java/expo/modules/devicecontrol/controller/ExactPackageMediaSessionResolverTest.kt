package expo.modules.devicecontrol.controller

import android.media.session.PlaybackState
import expo.modules.devicecontrol.model.MediaSessionSnapshotResult
import expo.modules.devicecontrol.model.MediaSessionTransportCommand
import expo.modules.devicecontrol.model.MediaSessionTransportResult
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 锁定 observation selection == command selection。
 *
 * 一旦两边各自演化出不同的挑选规则（例如一边 exact-match、一边 first()），
 * 这里的断言会失败，防止 session-selection contract 漂移。
 */
class ExactPackageMediaSessionResolverTest {
  private val neteaseActions = PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY

  private fun sessions(): List<FakeMediaSessionControllerSource> = listOf(
    FakeMediaSessionControllerSource("com.spotify.music", actions = neteaseActions, title = "Spotify"),
    FakeMediaSessionControllerSource(
      "com.netease.cloudmusic",
      actions = neteaseActions,
      title = "NetEase",
    ),
    FakeMediaSessionControllerSource("com.example.other", actions = neteaseActions, title = "Other"),
  )

  @Test
  fun `resolver 只接受完全相等的 packageName`() {
    val controllers = sessions()
    val resolver = ExactPackageMediaSessionResolver()

    assertSame(
      controllers[1],
      resolver.resolve("com.netease.cloudmusic", controllers),
    )
    assertTrue(
      resolver.resolve("com.netease", controllers) == null,
    )
    assertTrue(resolver.resolve("com.netease.cloudmusic".uppercase(), controllers) == null)
  }

  @Test
  fun `observation 与 command 选择同一个 exact package session identity`() {
    val controllers = sessions()
    val (spotify, netease, other) = controllers
    val packageName = "com.netease.cloudmusic"

    val snapshot = MediaSessionSnapshotReader(
      loadControllers = { controllers },
      accessReader = NotificationListenerAccessReader { true },
    ).read(packageName) as MediaSessionSnapshotResult.Available

    val dispatch = MediaSessionTransportController(
      loadControllers = { controllers },
      accessReader = NotificationListenerAccessReader { true },
    ).dispatch(packageName, "pause") as MediaSessionTransportResult.CommandDispatched

    // 两条路径都只触碰同一个 handle：snapshot 与 dispatch 各一次，其余 controller 零调用。
    assertEquals(packageName, snapshot.snapshot.packageName)
    assertEquals("NetEase", snapshot.snapshot.metadata.title)
    assertEquals(packageName, dispatch.packageName)
    assertEquals(1, netease.snapshotCalls)
    assertEquals(listOf(MediaSessionTransportCommand.PAUSE), netease.dispatchedCommands)
    assertEquals(0, spotify.snapshotCalls)
    assertEquals(0, other.snapshotCalls)
    assertTrue(spotify.dispatchedCommands.isEmpty())
    assertTrue(other.dispatchedCommands.isEmpty())
  }
}
