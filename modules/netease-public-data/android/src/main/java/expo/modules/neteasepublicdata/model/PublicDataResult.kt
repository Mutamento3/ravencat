package expo.modules.neteasepublicdata.model

enum class PublicDataFailureCode(val wireValue: String) {
  NETWORK_FAILURE("network_failure"),
  API_REJECTED("api_rejected"),
  INVALID_RESPONSE("invalid_response"),
  NOT_FOUND("not_found"),
}

data class PublicDataFailure(
  val code: PublicDataFailureCode,
  val message: String,
  val apiCode: Int? = null,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "code" to code.wireValue,
    "message" to message.take(300),
    "apiCode" to apiCode,
  )
}

sealed class PublicDataResult<out T> {
  data class Success<T>(val data: T) : PublicDataResult<T>()
  data class Failure(val error: PublicDataFailure) : PublicDataResult<Nothing>()

  fun toBridgeMap(mapData: (T) -> Any?): Map<String, Any?> = when (this) {
    is Success -> mapOf("ok" to true, "data" to mapData(data))
    is Failure -> mapOf("ok" to false, "error" to error.toMap())
  }
}

data class SongCandidate(
  val songId: Long,
  val name: String,
  val artists: List<String>,
  val album: String,
  val durationMs: Long,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "songId" to songId.toDouble(),
    "name" to name,
    "artists" to artists,
    "album" to album,
    "durationMs" to durationMs.toDouble(),
  )
}

data class PlaylistCandidate(
  val playlistId: Long,
  val name: String,
  val creatorName: String,
  val trackCount: Int,
) {
  fun toMap(): Map<String, Any> = mapOf(
    "playlistId" to playlistId.toDouble(),
    "name" to name,
    "creatorName" to creatorName,
    "trackCount" to trackCount,
  )
}

data class PublicPlaylist(
  val playlist: PlaylistCandidate,
  val totalTrackCount: Int,
  val offset: Int,
  val limit: Int,
  val tracks: List<SongCandidate>,
) {
  fun toMap(): Map<String, Any> = playlist.toMap() + mapOf(
    "totalTrackCount" to totalTrackCount,
    "offset" to offset,
    "limit" to limit,
    "hasMore" to (offset + tracks.size < totalTrackCount),
    "tracks" to tracks.map(SongCandidate::toMap),
  )
}

sealed class SongLyrics {
  data class Available(val text: String, val truncated: Boolean) : SongLyrics()
  data object NoLyrics : SongLyrics()
  data object Uncollected : SongLyrics()

  fun toMap(): Map<String, Any> = when (this) {
    is Available -> mapOf("status" to "available", "text" to text, "truncated" to truncated)
    NoLyrics -> mapOf("status" to "no_lyrics")
    Uncollected -> mapOf("status" to "uncollected")
  }
}
