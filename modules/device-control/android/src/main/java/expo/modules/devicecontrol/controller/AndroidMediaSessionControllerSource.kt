package expo.modules.devicecontrol.controller

import android.media.session.MediaController
import expo.modules.devicecontrol.model.MediaSessionSnapshot
import expo.modules.devicecontrol.model.MediaSessionTransportCommand

/**
 * Android MediaController 的 exact-package handle：observation 与 command 共用的同
 * 一个 session identity，解析只能经过 ExactPackageMediaSessionResolver。
 *
 * 只做平台字段读取与 TransportControls 直调：不做 poll、不做等待、不在调用后重新
 * 读取 playback state 验证结果。command 成功只代表请求已交给目标 session，
 * 最终 playback 事实必须由一次新的 snapshot 独立观察。
 */
internal class AndroidMediaSessionControllerSource(
  private val controller: MediaController,
) : MediaSessionControllerSource {
  override val packageName: String = controller.packageName

  override fun snapshot(): MediaSessionSnapshot {
    val playbackState = controller.playbackState
    return createMediaSessionSnapshot(
      packageName = packageName,
      playback = playbackState?.let {
        RawPlaybackState(
          it.state,
          it.position,
          it.playbackSpeed,
          it.lastPositionUpdateTime,
          it.actions,
        )
      },
      metadata = controller.metadata.toRawMetadata(),
      nowEpochMs = System.currentTimeMillis(),
      nowElapsedRealtimeMs = android.os.SystemClock.elapsedRealtime(),
    )
  }

  /** Command admission 的能力真值：只取当前 advertised actions，不推断当前 state。 */
  override fun actions(): Long = controller.playbackState?.actions ?: 0L

  override fun dispatch(command: MediaSessionTransportCommand) {
    val transportControls = controller.transportControls
    when (command) {
      MediaSessionTransportCommand.PAUSE -> transportControls.pause()
      MediaSessionTransportCommand.RESUME -> transportControls.play()
      MediaSessionTransportCommand.NEXT -> transportControls.skipToNext()
      MediaSessionTransportCommand.PREVIOUS -> transportControls.skipToPrevious()
    }
  }
}
