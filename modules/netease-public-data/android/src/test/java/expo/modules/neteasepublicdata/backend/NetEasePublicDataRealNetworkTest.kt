package expo.modules.neteasepublicdata.backend

import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.SongLyrics
import expo.modules.neteasepublicdata.protocol.HttpsEapiTransport
import expo.modules.neteasepublicdata.protocol.EapiResponse
import expo.modules.neteasepublicdata.protocol.EapiTransport
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** 显式 opt-in 的真实网络验证；默认 unit test 不访问外部网络。 */
class NetEasePublicDataRealNetworkTest {
  companion object {
    private const val ZERO_RESULT_QUERY = "\uE000\uE001\uE002\uE003\uE004\uE005\uE006\uE007"
  }

  private val backend = NetEasePublicDataBackend(HttpsEapiTransport())

  @Test
  fun `production Kotlin transport reports zero-result response shapes`() {
    assumeTrue(System.getProperty("netease.realNetwork") == "true")

    val recordingTransport = RecordingTransport(HttpsEapiTransport())
    val zeroResultBackend = NetEasePublicDataBackend(recordingTransport)

    assertTrue(success(zeroResultBackend.searchSongs(ZERO_RESULT_QUERY, 10)).isEmpty())
    reportZeroResultShape(recordingTransport.lastResponse, countKey = "songCount", arrayKey = "songs")

    assertTrue(success(zeroResultBackend.searchPublicPlaylists(ZERO_RESULT_QUERY, 10)).isEmpty())
    reportZeroResultShape(recordingTransport.lastResponse, countKey = "playlistCount", arrayKey = "playlists")
  }

  @Test
  fun `production Kotlin backend completes PHONE-8B1 public reads`() {
    assumeTrue(System.getProperty("netease.realNetwork") == "true")

    val songs = success(backend.searchSongs("晴天 周杰伦", 100))
    assertTrue(songs.size > 1)
    assertTrue(songs.any { it.songId == 186016L })

    val playlists = success(backend.searchPublicPlaylists("纯音乐", 50))
    assertTrue(playlists.any { it.playlistId == 4925292L })

    val firstPage = success(backend.getPublicPlaylist(4925292L, 0, 1000))
    assertEquals(1606, firstPage.totalTrackCount)
    assertEquals(1000, firstPage.tracks.size)
    assertTrue(firstPage.toMap()["hasMore"] as Boolean)
    val secondPage = success(backend.getPublicPlaylist(4925292L, 1000, 1000))
    assertEquals(606, secondPage.tracks.size)

    val lyrics = success(backend.getSongLyrics(186016L)) as SongLyrics.Available
    assertTrue(lyrics.text.isNotBlank())
    assertTrue(lyrics.text.length <= NetEaseResponseNormalizer.MAX_LYRIC_CHARACTERS)

    assertEquals(SongLyrics.Uncollected, success(backend.getSongLyrics(999999999999L)))

    val missingPlaylist = backend.getPublicPlaylist(999999999999L, 0, 10)
    assertEquals(
      PublicDataFailureCode.NOT_FOUND,
      (missingPlaylist as PublicDataResult.Failure).error.code,
    )
  }

  private fun <T> success(result: PublicDataResult<T>): T = when (result) {
    is PublicDataResult.Success -> result.data
    is PublicDataResult.Failure -> error("Unexpected backend failure: ${result.error}")
  }

  private fun reportZeroResultShape(response: EapiResponse?, countKey: String, arrayKey: String) {
    requireNotNull(response)
    assertEquals(200, response.httpStatus)
    assertEquals(200, response.body.getInt("code"))
    val result = response.body.getJSONObject("result")
    val count = result.getInt(countKey)
    assertEquals(0, count)
    val arrayPresent = result.has(arrayKey)
    val arrayLength = if (arrayPresent) result.getJSONArray(arrayKey).length() else null
    println(
      "ZERO_RESULT_SHAPE countKey=$countKey count=$count arrayKey=$arrayKey " +
        "arrayPresent=$arrayPresent arrayLength=$arrayLength resultKeys=${result.keys().asSequence().sorted().toList()}",
    )
  }

  private class RecordingTransport(private val delegate: EapiTransport) : EapiTransport {
    var lastResponse: EapiResponse? = null
      private set

    override fun request(uri: String, data: JSONObject): PublicDataResult<EapiResponse> {
      val result = delegate.request(uri, data)
      if (result is PublicDataResult.Success) lastResponse = result.data
      return result
    }
  }
}
