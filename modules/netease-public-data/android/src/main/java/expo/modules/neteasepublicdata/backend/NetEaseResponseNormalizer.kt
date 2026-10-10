package expo.modules.neteasepublicdata.backend

import expo.modules.neteasepublicdata.model.PlaylistCandidate
import expo.modules.neteasepublicdata.model.PublicDataFailure
import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.model.SongCandidate
import expo.modules.neteasepublicdata.model.SongLyrics
import expo.modules.neteasepublicdata.protocol.EapiResponse
import org.json.JSONArray
import org.json.JSONObject

object NetEaseResponseNormalizer {
  const val MAX_LYRIC_CHARACTERS = 12_000
  private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991L

  fun requireSuccess(response: EapiResponse, notFoundCode: Int? = null): PublicDataResult<JSONObject> {
    val code = response.body.opt("code")
    if (code !is Number) return invalid("响应缺少 numeric code")
    val apiCode = code.toInt()
    if (code.toDouble() != apiCode.toDouble()) return invalid("响应 business code 不是整数")
    if (apiCode != 200) {
      val failureCode = if (notFoundCode == apiCode) PublicDataFailureCode.NOT_FOUND
      else PublicDataFailureCode.API_REJECTED
      return PublicDataResult.Failure(PublicDataFailure(failureCode, "网易云拒绝了请求", apiCode))
    }
    if (response.httpStatus !in 200..299) {
      return PublicDataResult.Failure(PublicDataFailure(
        PublicDataFailureCode.API_REJECTED,
        "网易云 HTTP 状态为 ${response.httpStatus}",
        apiCode,
      ))
    }
    return PublicDataResult.Success(response.body)
  }

  fun songs(array: JSONArray): PublicDataResult<List<SongCandidate>> = mapArray(array, ::song)

  fun playlists(array: JSONArray): PublicDataResult<List<PlaylistCandidate>> = mapArray(array, ::playlist)

  fun trackIds(array: JSONArray): PublicDataResult<List<Long>> = mapArray(array) { item ->
    safePositiveLong(item, "id")
  }

  fun lyrics(body: JSONObject): PublicDataResult<SongLyrics> {
    if (body.opt("uncollected") == true) return PublicDataResult.Success(SongLyrics.Uncollected)
    if (body.opt("nolyric") == true) return PublicDataResult.Success(SongLyrics.NoLyrics)
    val lrc = body.opt("lrc") as? JSONObject ?: return invalid("歌词响应缺少 lrc")
    val lyric = lrc.opt("lyric") as? String ?: return invalid("歌词响应缺少 lyric")
    if (lyric.isBlank()) return invalid("歌词响应包含空 lyric")
    val bounded = lyric.take(MAX_LYRIC_CHARACTERS)
    return PublicDataResult.Success(SongLyrics.Available(bounded, bounded.length < lyric.length))
  }

  fun song(item: JSONObject): PublicDataResult<SongCandidate> = guarded {
    val id = safePositiveLong(item, "id").valueOrReturnFailure()
    val name = requiredBoundedString(item, "name", 200).valueOrReturnFailure()
    val artistArray = (item.opt("ar") ?: item.opt("artists")) as? JSONArray
      ?: return@guarded invalid("歌曲响应缺少 artists")
    if (artistArray.length() == 0) return@guarded invalid("歌曲响应 artists 为空")
    val artists = mutableListOf<String>()
    for (index in 0 until minOf(artistArray.length(), 20)) {
      val artist = artistArray.opt(index) as? JSONObject ?: return@guarded invalid("歌曲 artist 类型错误")
      artists += requiredBoundedString(artist, "name", 100).valueOrReturnFailure()
    }
    val albumObject = (item.opt("al") ?: item.opt("album")) as? JSONObject
      ?: return@guarded invalid("歌曲响应缺少 album")
    val album = requiredBoundedString(albumObject, "name", 200).valueOrReturnFailure()
    val durationValue = item.opt("dt") ?: item.opt("duration")
    val duration = safeNonNegativeLong(durationValue, "duration").valueOrReturnFailure()
    PublicDataResult.Success(SongCandidate(id, name, artists, album, duration))
  }

  fun playlist(item: JSONObject): PublicDataResult<PlaylistCandidate> = guarded {
    val id = safePositiveLong(item, "id").valueOrReturnFailure()
    val name = requiredBoundedString(item, "name", 200).valueOrReturnFailure()
    val creator = item.opt("creator") as? JSONObject ?: return@guarded invalid("歌单响应缺少 creator")
    val creatorName = requiredBoundedString(creator, "nickname", 100).valueOrReturnFailure()
    val trackCountValue = item.opt("trackCount")
    val trackCount = safeNonNegativeLong(trackCountValue, "trackCount").valueOrReturnFailure()
    if (trackCount > Int.MAX_VALUE) return@guarded invalid("trackCount 超出范围")
    PublicDataResult.Success(PlaylistCandidate(id, name, creatorName, trackCount.toInt()))
  }

  private fun requiredBoundedString(objectValue: JSONObject, key: String, max: Int): PublicDataResult<String> {
    val value = objectValue.opt(key) as? String ?: return invalid("响应缺少 string $key")
    return PublicDataResult.Success(value.take(max))
  }

  private fun safePositiveLong(objectValue: JSONObject, key: String): PublicDataResult<Long> =
    safeNonNegativeLong(objectValue.opt(key), key).let { result ->
      if (result is PublicDataResult.Success && result.data == 0L) invalid("$key 必须为正数") else result
    }

  private fun safeNonNegativeLong(value: Any?, field: String): PublicDataResult<Long> {
    val number = value as? Number ?: return invalid("响应缺少 numeric $field")
    val longValue = number.toLong()
    if (number.toDouble() != longValue.toDouble() || longValue < 0 || longValue > MAX_JS_SAFE_INTEGER) {
      return invalid("$field 超出安全整数范围")
    }
    return PublicDataResult.Success(longValue)
  }

  private fun <T> mapArray(
    array: JSONArray,
    transform: (JSONObject) -> PublicDataResult<T>,
  ): PublicDataResult<List<T>> {
    val values = mutableListOf<T>()
    for (index in 0 until array.length()) {
      val item = array.opt(index) as? JSONObject ?: return invalid("响应数组元素类型错误")
      when (val result = transform(item)) {
        is PublicDataResult.Success -> values += result.data
        is PublicDataResult.Failure -> return result
      }
    }
    return PublicDataResult.Success(values)
  }

  private fun <T> PublicDataResult<T>.valueOrReturnFailure(): T = when (this) {
    is PublicDataResult.Success -> data
    is PublicDataResult.Failure -> throw InvalidShapeException(error)
  }

  private fun <T> guarded(block: () -> PublicDataResult<T>): PublicDataResult<T> = try {
    block()
  } catch (error: InvalidShapeException) {
    PublicDataResult.Failure(error.failure)
  }

  private fun <T> invalid(message: String): PublicDataResult<T> = PublicDataResult.Failure(
    PublicDataFailure(PublicDataFailureCode.INVALID_RESPONSE, message),
  )

  class InvalidShapeException(val failure: PublicDataFailure) : RuntimeException(failure.message)
}
