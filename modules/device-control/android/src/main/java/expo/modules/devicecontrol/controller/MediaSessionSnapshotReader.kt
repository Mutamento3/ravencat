package expo.modules.devicecontrol.controller

import android.media.MediaMetadata
import android.media.session.PlaybackState
import android.os.SystemClock
import expo.modules.devicecontrol.model.MediaSessionActionsSnapshot
import expo.modules.devicecontrol.model.MediaSessionMetadataSnapshot
import expo.modules.devicecontrol.model.MediaSessionPlaybackSnapshot
import expo.modules.devicecontrol.model.MediaSessionSnapshot
import expo.modules.devicecontrol.model.MediaSessionSnapshotResult

internal data class RawPlaybackState(
  val state: Int,
  val positionMs: Long,
  val speed: Float,
  val updatedAtElapsedRealtimeMs: Long,
  val actions: Long,
)

internal data class RawMediaMetadata(
  val mediaId: String?,
  val title: String?,
  val artist: String?,
  val album: String?,
  val durationMs: Long?,
)

/**
 * exact-package MediaSession 读取；不执行任何 TransportControls。
 *
 * session selection 与 command 共用 ExactPackageMediaSessionResolver：
 * observation 与 command 解析到的必然是同一个 session identity。
 */
internal class MediaSessionSnapshotReader(
  private val loadControllers: () -> List<MediaSessionControllerSource>,
  private val accessReader: NotificationListenerAccessReader,
) {
  fun read(rawPackageName: String): MediaSessionSnapshotResult {
    val packageName = rawPackageName.trim()
    if (!isValidExactPackageName(packageName)) {
      return MediaSessionSnapshotResult.InvalidPackageName("packageName 必须是单个 exact package")
    }
    if (!accessReader.isGranted()) {
      return MediaSessionSnapshotResult.PermissionNotGranted
    }

    return try {
      val source = ExactPackageMediaSessionResolver().resolve(packageName, loadControllers())
        ?: return MediaSessionSnapshotResult.NoActiveSession(packageName)
      MediaSessionSnapshotResult.Available(source.snapshot())
    } catch (error: Exception) {
      MediaSessionSnapshotResult.Failed(error.message ?: error.javaClass.simpleName)
    }
  }
}

internal fun createMediaSessionSnapshot(
  packageName: String,
  playback: RawPlaybackState?,
  metadata: RawMediaMetadata?,
  nowEpochMs: Long,
  nowElapsedRealtimeMs: Long,
): MediaSessionSnapshot {
  val playbackSnapshot = if (playback == null) {
    MediaSessionPlaybackSnapshot("none", null, null, null)
  } else {
    val updatedAtEpochMs = playback.updatedAtElapsedRealtimeMs.takeIf { it > 0L }?.let {
      nowEpochMs - (nowElapsedRealtimeMs - it)
    }
    MediaSessionPlaybackSnapshot(
      state = normalizePlaybackState(playback.state),
      positionMs = playback.positionMs,
      speed = playback.speed,
      updatedAtEpochMs = updatedAtEpochMs,
    )
  }
  return MediaSessionSnapshot(
    packageName = packageName,
    playback = playbackSnapshot,
    metadata = metadata?.let {
      MediaSessionMetadataSnapshot(it.mediaId, it.title, it.artist, it.album, it.durationMs)
    } ?: MediaSessionMetadataSnapshot(null, null, null, null, null),
    actions = actionsSnapshot(playback?.actions ?: 0L),
  )
}

internal fun normalizePlaybackState(state: Int): String = when (state) {
  PlaybackState.STATE_NONE -> "none"
  PlaybackState.STATE_STOPPED -> "stopped"
  PlaybackState.STATE_PAUSED -> "paused"
  PlaybackState.STATE_PLAYING -> "playing"
  PlaybackState.STATE_FAST_FORWARDING -> "fast_forwarding"
  PlaybackState.STATE_REWINDING -> "rewinding"
  PlaybackState.STATE_BUFFERING -> "buffering"
  PlaybackState.STATE_ERROR -> "error"
  PlaybackState.STATE_CONNECTING -> "connecting"
  PlaybackState.STATE_SKIPPING_TO_PREVIOUS -> "skipping_to_previous"
  PlaybackState.STATE_SKIPPING_TO_NEXT -> "skipping_to_next"
  PlaybackState.STATE_SKIPPING_TO_QUEUE_ITEM -> "skipping_to_queue_item"
  else -> "unknown"
}

internal fun actionsSnapshot(actions: Long): MediaSessionActionsSnapshot =
  MediaSessionActionsSnapshot(
    play = actions hasAction PlaybackState.ACTION_PLAY,
    pause = actions hasAction PlaybackState.ACTION_PAUSE,
    playPause = actions hasAction PlaybackState.ACTION_PLAY_PAUSE,
    stop = actions hasAction PlaybackState.ACTION_STOP,
    next = actions hasAction PlaybackState.ACTION_SKIP_TO_NEXT,
    previous = actions hasAction PlaybackState.ACTION_SKIP_TO_PREVIOUS,
    seekTo = actions hasAction PlaybackState.ACTION_SEEK_TO,
    playFromMediaId = actions hasAction PlaybackState.ACTION_PLAY_FROM_MEDIA_ID,
    playFromSearch = actions hasAction PlaybackState.ACTION_PLAY_FROM_SEARCH,
    playFromUri = actions hasAction PlaybackState.ACTION_PLAY_FROM_URI,
    prepare = actions hasAction PlaybackState.ACTION_PREPARE,
    prepareFromMediaId = actions hasAction PlaybackState.ACTION_PREPARE_FROM_MEDIA_ID,
    prepareFromSearch = actions hasAction PlaybackState.ACTION_PREPARE_FROM_SEARCH,
    prepareFromUri = actions hasAction PlaybackState.ACTION_PREPARE_FROM_URI,
  )

private infix fun Long.hasAction(action: Long): Boolean = this and action != 0L

internal fun MediaMetadata?.toRawMetadata(): RawMediaMetadata? {
  if (this == null) return null
  return RawMediaMetadata(
    mediaId = getString(MediaMetadata.METADATA_KEY_MEDIA_ID),
    title = getString(MediaMetadata.METADATA_KEY_TITLE),
    artist = getString(MediaMetadata.METADATA_KEY_ARTIST),
    album = getString(MediaMetadata.METADATA_KEY_ALBUM),
    durationMs = if (containsKey(MediaMetadata.METADATA_KEY_DURATION)) {
      getLong(MediaMetadata.METADATA_KEY_DURATION)
    } else {
      null
    },
  )
}
