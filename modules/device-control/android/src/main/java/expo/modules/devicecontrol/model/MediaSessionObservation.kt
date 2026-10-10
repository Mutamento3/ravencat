package expo.modules.devicecontrol.model

/** Android MediaSession 的通用观察快照；只表达平台标准字段。 */
data class MediaSessionSnapshot(
  val packageName: String,
  val playback: MediaSessionPlaybackSnapshot,
  val metadata: MediaSessionMetadataSnapshot,
  val actions: MediaSessionActionsSnapshot,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "packageName" to packageName,
    "playback" to playback.toMap(),
    "metadata" to metadata.toMap(),
    "actions" to actions.toMap(),
  )
}
data class MediaSessionPlaybackSnapshot(
  val state: String,
  val positionMs: Long?,
  val speed: Float?,
  val updatedAtEpochMs: Long?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "state" to state,
    "positionMs" to positionMs,
    "speed" to speed,
    "updatedAtEpochMs" to updatedAtEpochMs,
  )
}

data class MediaSessionMetadataSnapshot(
  val mediaId: String?,
  val title: String?,
  val artist: String?,
  val album: String?,
  val durationMs: Long?,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "mediaId" to mediaId,
    "title" to title,
    "artist" to artist,
    "album" to album,
    "durationMs" to durationMs,
  )
}

/** Session advertised action bit；不证明具体参数（例如 mediaId）可被目标 App 接受。 */
data class MediaSessionActionsSnapshot(
  val play: Boolean,
  val pause: Boolean,
  val playPause: Boolean,
  val stop: Boolean,
  val next: Boolean,
  val previous: Boolean,
  val seekTo: Boolean,
  val playFromMediaId: Boolean,
  val playFromSearch: Boolean,
  val playFromUri: Boolean,
  val prepare: Boolean,
  val prepareFromMediaId: Boolean,
  val prepareFromSearch: Boolean,
  val prepareFromUri: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "play" to play,
    "pause" to pause,
    "playPause" to playPause,
    "stop" to stop,
    "next" to next,
    "previous" to previous,
    "seekTo" to seekTo,
    "playFromMediaId" to playFromMediaId,
    "playFromSearch" to playFromSearch,
    "playFromUri" to playFromUri,
    "prepare" to prepare,
    "prepareFromMediaId" to prepareFromMediaId,
    "prepareFromSearch" to prepareFromSearch,
    "prepareFromUri" to prepareFromUri,
  )
}

sealed interface MediaSessionSnapshotResult {
  fun toMap(): Map<String, Any?>

  data class Available(val snapshot: MediaSessionSnapshot) : MediaSessionSnapshotResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "session_snapshot_available",
      "snapshot" to snapshot.toMap(),
    )
  }

  data object PermissionNotGranted : MediaSessionSnapshotResult {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "permission_not_granted")
  }

  data class NoActiveSession(val packageName: String) : MediaSessionSnapshotResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "no_active_session",
      "packageName" to packageName,
    )
  }

  data class InvalidPackageName(val reason: String) : MediaSessionSnapshotResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "invalid_package_name",
      "reason" to reason,
    )
  }

  data class Failed(val reason: String) : MediaSessionSnapshotResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "snapshot_failed",
      "reason" to reason,
    )
  }
}
