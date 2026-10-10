package expo.modules.neteasepublicdata.backend

import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataFailure
import expo.modules.neteasepublicdata.model.PublicDataResult
import expo.modules.neteasepublicdata.protocol.EapiResponse
import expo.modules.neteasepublicdata.protocol.EapiTransport
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NetEasePublicDataBackendTest {
  @Test
  fun `song search keeps all candidates in upstream order`() {
    val body = JSONObject("""
      {"code":200,"result":{"songs":[
        {"id":1,"name":"翻唱","ar":[{"name":"甲"}],"al":{"name":"专辑甲"},"dt":1000},
        {"id":186016,"name":"晴天","ar":[{"name":"周杰伦"}],"al":{"name":"叶惠美"},"dt":269000}
      ]}}
    """.trimIndent())
    val songs = success(NetEasePublicDataBackend(FakeTransport(mapOf(
      "/api/cloudsearch/pc" to listOf(EapiResponse(200, body)),
    ))).searchSongs("晴天 周杰伦", 10))
    assertEquals(listOf(1L, 186016L), songs.map { it.songId })
  }

  @Test
  fun `search output never exceeds requested limit`() {
    val body = JSONObject().put("code", 200).put("result", JSONObject().put(
      "songs",
      JSONArray((1L..5L).map(::songJson)),
    ))
    val songs = success(NetEasePublicDataBackend(FakeTransport(mapOf(
      "/api/cloudsearch/pc" to listOf(EapiResponse(200, body)),
    ))).searchSongs("有界结果", 2))
    assertEquals(listOf(1L, 2L), songs.map { it.songId })
  }

  @Test
  fun `explicit zero counts allow missing search arrays only`() {
    val backend = NetEasePublicDataBackend(FakeTransport(mapOf(
      "/api/cloudsearch/pc" to listOf(
        EapiResponse(200, JSONObject("{\"code\":200,\"result\":{\"songCount\":0}}")),
        EapiResponse(200, JSONObject("{\"code\":200,\"result\":{\"playlistCount\":0}}")),
      ),
    )))
    assertTrue(success(backend.searchSongs("无结果", 10)).isEmpty())
    assertTrue(success(backend.searchPublicPlaylists("无结果", 10)).isEmpty())

    for (result in listOf(
      JSONObject("{\"code\":200,\"result\":{\"songCount\":1}}"),
      JSONObject("{\"code\":200,\"result\":{}}"),
      JSONObject("{\"code\":200,\"result\":{\"songCount\":0,\"songs\":null}}"),
    )) {
      val malformed = NetEasePublicDataBackend(FakeTransport(mapOf(
        "/api/cloudsearch/pc" to listOf(EapiResponse(200, result)),
      ))).searchSongs("错误形状", 10)
      assertEquals(
        PublicDataFailureCode.INVALID_RESPONSE,
        (malformed as PublicDataResult.Failure).error.code,
      )
    }
  }

  @Test
  fun `playlist uses full track identity and requests a bounded page`() {
    val ids = (1L..1606L).toList()
    val playlist = JSONObject()
      .put("code", 200)
      .put("playlist", JSONObject()
        .put("id", 4925292)
        .put("name", "大歌单")
        .put("creator", JSONObject().put("nickname", "创建者"))
        .put("trackCount", ids.size)
        .put("trackIds", JSONArray(ids.map { JSONObject().put("id", it) })))
    val songs = JSONObject().put("code", 200).put("songs", JSONArray(ids.drop(1000).map(::songJson)))
    val fake = FakeTransport(mapOf(
      "/api/v6/playlist/detail" to listOf(EapiResponse(200, playlist)),
      "/api/v3/song/detail" to listOf(EapiResponse(200, songs)),
    ))
    val result = success(NetEasePublicDataBackend(fake).getPublicPlaylist(4925292, 1000, 606))
    assertEquals(1606, result.totalTrackCount)
    assertEquals(606, result.tracks.size)
    assertEquals(1001L, result.tracks.first().songId)
    assertFalse(result.toMap()["hasMore"] as Boolean)
    assertEquals(1, fake.requestCount("/api/v3/song/detail"))
  }

  @Test
  fun `batching splits the verified 1606 identity set into 1000 and 606`() {
    val batches = NetEasePublicDataBackend(FakeTransport(emptyMap())).batchTrackIds((1L..1606L).toList())
    assertEquals(listOf(1000, 606), batches.map(List<Long>::size))
  }

  @Test
  fun `playlist 404 and successful malformed shape keep typed failures`() {
    val notFound = NetEasePublicDataBackend(FakeTransport(mapOf(
      "/api/v6/playlist/detail" to listOf(EapiResponse(200, JSONObject("{\"code\":404}"))),
    ))).getPublicPlaylist(999999999999, 0, 10)
    assertEquals(PublicDataFailureCode.NOT_FOUND, (notFound as PublicDataResult.Failure).error.code)

    val malformed = NetEasePublicDataBackend(FakeTransport(mapOf(
      "/api/cloudsearch/pc" to listOf(EapiResponse(200, JSONObject("{\"code\":200}"))),
    ))).searchSongs("晴天", 10)
    assertEquals(PublicDataFailureCode.INVALID_RESPONSE, (malformed as PublicDataResult.Failure).error.code)
  }

  @Test
  fun `transport failure remains network failure`() {
    val backend = NetEasePublicDataBackend(EapiTransport { _, _ ->
      PublicDataResult.Failure(PublicDataFailure(
        PublicDataFailureCode.NETWORK_FAILURE,
        "timeout",
      ))
    })
    val result = backend.searchSongs("晴天", 10)
    assertEquals(
      PublicDataFailureCode.NETWORK_FAILURE,
      (result as PublicDataResult.Failure).error.code,
    )
  }

  private fun songJson(id: Long) = JSONObject()
    .put("id", id)
    .put("name", "歌$id")
    .put("ar", JSONArray(listOf(JSONObject().put("name", "歌手"))))
    .put("al", JSONObject().put("name", "专辑"))
    .put("dt", 1000)

  private fun <T> success(result: PublicDataResult<T>): T = when (result) {
    is PublicDataResult.Success -> result.data
    is PublicDataResult.Failure -> error("Unexpected backend failure: ${result.error}")
  }

  private class FakeTransport(responses: Map<String, List<EapiResponse>>) : EapiTransport {
    private val queues = responses.mapValues { (_, values) -> ArrayDeque(values) }
    private val counts = mutableMapOf<String, Int>()

    override fun request(uri: String, data: JSONObject): PublicDataResult<EapiResponse> {
      counts[uri] = (counts[uri] ?: 0) + 1
      return PublicDataResult.Success(queues[uri]?.removeFirst() ?: error("Unexpected request: $uri"))
    }

    fun requestCount(uri: String): Int = counts[uri] ?: 0
  }
}
