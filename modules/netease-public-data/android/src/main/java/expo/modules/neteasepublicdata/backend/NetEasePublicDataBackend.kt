package expo.modules.neteasepublicdata.backend

import expo.modules.neteasepublicdata.backend.NetEaseResponseNormalizer.InvalidShapeException
import expo.modules.neteasepublicdata.model.PlaylistCandidate
import expo.modules.neteasepublicdata.model.PublicDataFailure
import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.model.PublicPlaylist
import expo.modules.neteasepublicdata.model.SongCandidate
import expo.modules.neteasepublicdata.model.SongLyrics
import expo.modules.neteasepublicdata.protocol.EapiResponse
import expo.modules.neteasepublicdata.protocol.EapiTransport
import org.json.JSONArray
import org.json.JSONObject

class NetEasePublicDataBackend(private val transport: EapiTransport) {
  companion object {
    const val MAX_SEARCH_LIMIT = 100
    const val MAX_PLAYLIST_PAGE_LIMIT = 1_000
    const val MAX_PLAYLIST_TRACK_COUNT = 100_000
    const val SONG_DETAIL_BATCH_SIZE = 1_000
  }

  fun searchSongs(query: String, limit: Int): PublicDataResult<List<SongCandidate>> = guarded {
    validateSearch(query, limit)?.let { return@guarded it }
    val response = request("/api/cloudsearch/pc", JSONObject()
      .put("s", query)
      .put("type", 1)
      .put("limit", limit)
      .put("offset", 0)
      .put("total", true)).valueOrReturnFailure()
    val body = NetEaseResponseNormalizer.requireSuccess(response).valueOrReturnFailure()
    val result = body.opt("result") as? JSONObject ?: return@guarded invalid("搜索响应缺少 result")
    val songs = searchResultArray(result, arrayKey = "songs", countKey = "songCount")
      .valueOrReturnFailure()
    when (val normalized = NetEaseResponseNormalizer.songs(songs)) {
      is PublicDataResult.Success -> PublicDataResult.Success(normalized.data.take(limit))
      is PublicDataResult.Failure -> normalized
    }
  }

  fun searchPublicPlaylists(query: String, limit: Int): PublicDataResult<List<PlaylistCandidate>> = guarded {
    validateSearch(query, limit)?.let { return@guarded it }
    val response = request("/api/cloudsearch/pc", JSONObject()
      .put("s", query)
      .put("type", 1000)
      .put("limit", limit)
      .put("offset", 0)
      .put("total", true)).valueOrReturnFailure()
    val body = NetEaseResponseNormalizer.requireSuccess(response).valueOrReturnFailure()
    val result = body.opt("result") as? JSONObject ?: return@guarded invalid("搜索响应缺少 result")
    val playlists = searchResultArray(result, arrayKey = "playlists", countKey = "playlistCount")
      .valueOrReturnFailure()
    when (val normalized = NetEaseResponseNormalizer.playlists(playlists)) {
      is PublicDataResult.Success -> PublicDataResult.Success(normalized.data.take(limit))
      is PublicDataResult.Failure -> normalized
    }
  }

  fun getPublicPlaylist(playlistId: Long, offset: Int, limit: Int): PublicDataResult<PublicPlaylist> = guarded {
    if (playlistId <= 0 || offset < 0 || limit !in 1..MAX_PLAYLIST_PAGE_LIMIT) {
      return@guarded invalid("歌单分页参数超出 contract")
    }
    val detailResponse = request("/api/v6/playlist/detail", JSONObject()
      .put("id", playlistId)
      .put("n", 100000)
      .put("s", 8)).valueOrReturnFailure()
    val body = NetEaseResponseNormalizer.requireSuccess(detailResponse, notFoundCode = 404)
      .valueOrReturnFailure()
    val playlistObject = body.opt("playlist") as? JSONObject
      ?: return@guarded invalid("歌单响应缺少 playlist")
    val playlist = NetEaseResponseNormalizer.playlist(playlistObject).valueOrReturnFailure()
    val rawTrackIds = playlistObject.opt("trackIds") as? JSONArray
      ?: return@guarded invalid("歌单响应缺少 trackIds")
    val trackIds = NetEaseResponseNormalizer.trackIds(rawTrackIds).valueOrReturnFailure()
    if (playlist.trackCount != trackIds.size) return@guarded invalid("trackCount 与 trackIds 不一致")
    if (trackIds.size > MAX_PLAYLIST_TRACK_COUNT) return@guarded invalid("歌单 trackIds 超出大小上限")
    val requestedIds = trackIds.drop(offset).take(limit)
    val tracks = mutableListOf<SongCandidate>()
    for (batch in batchTrackIds(requestedIds)) {
      val detail = request("/api/v3/song/detail", JSONObject().put("c", JSONArray(
        batch.map { id -> JSONObject().put("id", id) },
      ).toString())).valueOrReturnFailure()
      val detailBody = NetEaseResponseNormalizer.requireSuccess(detail).valueOrReturnFailure()
      val songs = detailBody.opt("songs") as? JSONArray
        ?: return@guarded invalid("歌曲详情响应缺少 songs")
      val normalized = NetEaseResponseNormalizer.songs(songs).valueOrReturnFailure()
      if (normalized.map { it.songId } != batch) return@guarded invalid("歌曲详情未完整匹配请求 trackIds")
      tracks += normalized
    }
    PublicDataResult.Success(PublicPlaylist(playlist, trackIds.size, offset, limit, tracks))
  }

  fun getSongLyrics(songId: Long): PublicDataResult<SongLyrics> = guarded {
    if (songId <= 0) return@guarded invalid("songId 必须为正数")
    val response = request("/api/song/lyric", JSONObject()
      .put("id", songId)
      .put("tv", -1)
      .put("lv", -1)
      .put("rv", -1)
      .put("kv", -1)
      .put("_nmclfl", 1)).valueOrReturnFailure()
    val body = NetEaseResponseNormalizer.requireSuccess(response).valueOrReturnFailure()
    NetEaseResponseNormalizer.lyrics(body)
  }

  internal fun batchTrackIds(ids: List<Long>): List<List<Long>> = ids.chunked(SONG_DETAIL_BATCH_SIZE)

  private fun request(uri: String, data: JSONObject): PublicDataResult<EapiResponse> = transport.request(uri, data)

  private fun validateSearch(query: String, limit: Int): PublicDataResult.Failure? {
    if (query.isBlank() || query.length > 200 || limit !in 1..MAX_SEARCH_LIMIT) {
      return invalid("搜索参数超出 contract")
    }
    return null
  }

  private fun searchResultArray(
    result: JSONObject,
    arrayKey: String,
    countKey: String,
  ): PublicDataResult<JSONArray> {
    if (result.has(arrayKey)) {
      val array = result.opt(arrayKey) as? JSONArray
        ?: return invalid("搜索响应 $arrayKey 类型错误")
      return PublicDataResult.Success(array)
    }
    val count = result.opt(countKey) as? Number
    if (count != null && count.toDouble() == 0.0) return PublicDataResult.Success(JSONArray())
    return invalid("搜索响应缺少 $arrayKey")
  }

  private fun <T> guarded(block: () -> PublicDataResult<T>): PublicDataResult<T> = try {
    block()
  } catch (error: InvalidShapeException) {
    PublicDataResult.Failure(error.failure)
  }

  private fun <T> PublicDataResult<T>.valueOrReturnFailure(): T = when (this) {
    is PublicDataResult.Success -> data
    is PublicDataResult.Failure -> throw InvalidShapeException(error)
  }

  private fun invalid(message: String) = PublicDataResult.Failure(PublicDataFailure(
    PublicDataFailureCode.INVALID_RESPONSE,
    message,
  ))
}
