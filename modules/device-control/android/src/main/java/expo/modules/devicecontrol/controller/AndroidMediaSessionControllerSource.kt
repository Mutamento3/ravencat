package expo.modules.devicecontrol.controller

import android.content.Context
import android.media.MediaRouter2
import android.media.session.MediaController
import expo.modules.devicecontrol.model.MediaSessionAudioOutputSnapshot
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
  private val context: Context,
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
    ).copy(audioOutput = readAudioOutput())
  }

  private fun readAudioOutput(): MediaSessionAudioOutputSnapshot? {
    // 输出设备观察失败不改变播放事实或 Activity eligibility；只在这一原生边界分类失败。
    return try {
      createMediaSessionAudioOutputSnapshot(controller.playbackInfo?.playbackType) {
        MediaRouter2.getInstance(context).systemController.selectedRoutes.map { it.name.toString() }
      }
    } catch (error: Exception) {
      android.util.Log.w("RavenCatMediaSession", "系统媒体输出观察失败", error)
      null
    }
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

/** 只有本地播放才读取手机媒体路由，避免把投屏或远程播放器误报为本机输出。 */
internal fun createMediaSessionAudioOutputSnapshot(
  playbackType: Int?,
  readSystemDeviceNames: () -> List<String>,
): MediaSessionAudioOutputSnapshot? = when (playbackType) {
  MediaController.PlaybackInfo.PLAYBACK_TYPE_LOCAL ->
    MediaSessionAudioOutputSnapshot("local", readSystemDeviceNames())
  MediaController.PlaybackInfo.PLAYBACK_TYPE_REMOTE ->
    MediaSessionAudioOutputSnapshot("remote", emptyList())
  else -> null
}
