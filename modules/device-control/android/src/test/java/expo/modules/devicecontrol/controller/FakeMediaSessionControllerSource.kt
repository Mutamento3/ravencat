package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.MediaSessionActionsSnapshot
import expo.modules.devicecontrol.model.MediaSessionMetadataSnapshot
import expo.modules.devicecontrol.model.MediaSessionPlaybackSnapshot
import expo.modules.devicecontrol.model.MediaSessionSnapshot
import expo.modules.devicecontrol.model.MediaSessionTransportCommand

/**
 * 测试用 exact-package session handle。
 *
 * 同时记录 snapshot 调用与 dispatch 调用，因此可以证明 observation 与 command
 * 解析到的是同一个 session identity，也能证明未被选中的 controller 调用次数为 0。
 */
internal class FakeMediaSessionControllerSource(
  override val packageName: String,
  private val actions: Long = 0L,
  private val title: String = "title",
  private val dispatchError: String? = null,
) : MediaSessionControllerSource {
  var snapshotCalls = 0
    private set
  val dispatchedCommands = mutableListOf<MediaSessionTransportCommand>()

  override fun snapshot(): MediaSessionSnapshot {
    snapshotCalls += 1
    return MediaSessionSnapshot(
      packageName,
      MediaSessionPlaybackSnapshot("playing", 10L, 1f, 20L),
      MediaSessionMetadataSnapshot(null, title, null, null, null),
      MediaSessionActionsSnapshot(
        play = false,
        pause = false,
        playPause = false,
        stop = false,
        next = false,
        previous = false,
        seekTo = false,
        playFromMediaId = false,
        playFromSearch = false,
        playFromUri = false,
        prepare = false,
        prepareFromMediaId = false,
        prepareFromSearch = false,
        prepareFromUri = false,
      ),
    )
  }

  override fun actions(): Long = actions

  override fun dispatch(command: MediaSessionTransportCommand) {
    dispatchedCommands += command
    dispatchError?.let { error(it) }
  }
}
