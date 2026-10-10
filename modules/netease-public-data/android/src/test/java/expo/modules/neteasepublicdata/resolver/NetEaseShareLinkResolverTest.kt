package expo.modules.neteasepublicdata.resolver

import expo.modules.neteasepublicdata.model.NetEaseSharedResource
import expo.modules.neteasepublicdata.model.ShareLinkFailureCode
import expo.modules.neteasepublicdata.model.ShareLinkResult
import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Test

class NetEaseShareLinkResolverTest {
  @Test
  fun `direct song URL resolves without network`() {
    val transport = RecordingTransport()
    val result = NetEaseShareLinkResolver(transport).resolve(
      "https://music.163.com/song?id=2657785221",
    )
    assertEquals(NetEaseSharedResource.Song(2657785221), success(result))
    assertEquals(listOf<String>(), transport.requestedHosts)
  }

  @Test
  fun `direct playlist URL resolves without network`() {
    val result = NetEaseShareLinkResolver(RecordingTransport()).resolve(
      "https://music.163.com/playlist?id=4925292",
    )
    assertEquals(NetEaseSharedResource.Playlist(4925292), success(result))
  }

  @Test
  fun `mobile canonical forms resolve`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    assertEquals(
      NetEaseSharedResource.Song(2657785221),
      success(resolver.resolve("https://y.music.163.com/m/song?id=2657785221")),
    )
    assertEquals(
      NetEaseSharedResource.Playlist(4925292),
      success(resolver.resolve("https://y.music.163.com/m/playlist?id=4925292")),
    )
  }

  @Test
  fun `canonical forms allow an optional trailing slash`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (path in listOf("/song", "/song/", "/m/song", "/m/song/")) {
      assertEquals(
        path,
        NetEaseSharedResource.Song(1),
        success(resolver.resolve("https://music.163.com$path?id=1")),
      )
    }
    for (path in listOf("/playlist", "/playlist/", "/m/playlist", "/m/playlist/")) {
      assertEquals(
        path,
        NetEaseSharedResource.Playlist(1),
        success(resolver.resolve("https://music.163.com$path?id=1")),
      )
    }
  }

  @Test
  fun `canonical resource paths reject extra segments`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (path in listOf(
      "/song/foo",
      "/playlist/foo",
      "/m/song/foo",
      "/m/playlist/foo",
      "/song/foo/bar",
    )) {
      assertFailure(
        resolver.resolve("https://music.163.com$path?id=1"),
        ShareLinkFailureCode.UNRESOLVABLE_SHARE_LINK,
        path,
      )
    }
  }

  @Test
  fun `short link resolves to song through redirect`() {
    val transport = RecordingTransport(mapOf(
      "163cn.tv" to ShareLinkRedirectResult.Redirect(
        "https://y.music.163.com/m/song?id=2657785221&uct2=ignored",
      ),
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/bfxtWeE7")
    assertEquals(NetEaseSharedResource.Song(2657785221), success(result))
    assertEquals(listOf("163cn.tv"), transport.requestedHosts)
  }

  @Test
  fun `short link resolves to playlist through redirect`() {
    val transport = RecordingTransport(mapOf(
      "163cn.tv" to ShareLinkRedirectResult.Redirect(
        "https://music.163.com/playlist?id=4925292",
      ),
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/bfxtWeE7")
    assertEquals(NetEaseSharedResource.Playlist(4925292), success(result))
  }

  @Test
  fun `blank and non-url inputs are invalid_url`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (input in listOf("", "   ", "not a url", "https://", "http://music.163.com/song?id=1")) {
      assertFailure(resolver.resolve(input), ShareLinkFailureCode.INVALID_URL, input)
    }
  }

  @Test
  fun `non-https schemes are rejected`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (input in listOf(
      "http://music.163.com/song?id=1",
      "file:///etc/passwd",
      "content://x",
      "intent://x",
      "javascript:alert(1)",
      "data:text/plain,x",
    )) {
      assertFailure(resolver.resolve(input), ShareLinkFailureCode.INVALID_URL, input)
    }
  }

  @Test
  fun `third-party and lookalike hosts are unsupported_host`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (input in listOf(
      "https://example.com/song?id=1",
      "https://music.163.com.attacker.example/song?id=1",
      "https://163.com/song?id=1",
      "https://localhost/song?id=1",
      "https://127.0.0.1/song?id=1",
    )) {
      assertFailure(resolver.resolve(input), ShareLinkFailureCode.UNSUPPORTED_HOST, input)
    }
  }

  @Test
  fun `invalid resource ids are rejected`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (input in listOf(
      "https://music.163.com/song?id=0",
      "https://music.163.com/song?id=-1",
      "https://music.163.com/song?id=1.5",
      "https://music.163.com/song?id=abc",
      "https://music.163.com/song?id=99999999999999999",
      "https://music.163.com/song",
      "https://music.163.com/playlist?id=",
    )) {
      assertFailure(resolver.resolve(input), ShareLinkFailureCode.INVALID_RESOURCE_ID, input)
    }
  }

  @Test
  fun `unsupported resource types are rejected`() {
    val resolver = NetEaseShareLinkResolver(RecordingTransport())
    for (input in listOf(
      "https://music.163.com/album?id=1",
      "https://music.163.com/artist?id=1",
      "https://y.music.163.com/m/mv?id=1",
      "https://music.163.com/user/home?id=1",
    )) {
      assertFailure(
        resolver.resolve(input),
        ShareLinkFailureCode.UNSUPPORTED_RESOURCE_TYPE,
        input,
      )
    }
  }

  @Test
  fun `canonical host without identity is unresolvable`() {
    val transport = RecordingTransport()
    val result = NetEaseShareLinkResolver(transport).resolve("https://music.163.com/")
    assertFailure(result, ShareLinkFailureCode.UNRESOLVABLE_SHARE_LINK)
    assertEquals(listOf("music.163.com"), transport.requestedHosts)
  }

  @Test
  fun `redirect to third-party host is rejected and never fetched`() {
    val transport = RecordingTransport(mapOf(
      "163cn.tv" to ShareLinkRedirectResult.Redirect("https://evil.example.com/song?id=1"),
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/bfxtWeE7")
    assertFailure(result, ShareLinkFailureCode.REDIRECT_REJECTED)
    // 关键安全不变量：第三方 host 绝不能被真实请求。
    assertEquals(listOf("163cn.tv"), transport.requestedHosts)
  }

  @Test
  fun `redirect to http scheme is rejected`() {
    val transport = RecordingTransport(mapOf(
      "163cn.tv" to ShareLinkRedirectResult.Redirect("http://music.163.com/song?id=1"),
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/bfxtWeE7")
    assertFailure(result, ShareLinkFailureCode.REDIRECT_REJECTED)
    assertEquals(listOf("163cn.tv"), transport.requestedHosts)
  }

  @Test
  fun `redirect exceeding max hops is too_many_redirects`() {
    val transport = RecordingTransport(default = ShareLinkRedirectResult.Redirect(
      "https://163cn.tv/loop",
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/loop")
    assertFailure(result, ShareLinkFailureCode.TOO_MANY_REDIRECTS)
    // 最多跟随 MAX_REDIRECTS 跳，不再请求更多。
    assertEquals(NetEaseShareLinkResolver.MAX_REDIRECTS, transport.requestedHosts.size)
  }

  @Test
  fun `network failure is preserved`() {
    val transport = RecordingTransport(mapOf(
      "163cn.tv" to ShareLinkRedirectResult.Failure(
        expo.modules.neteasepublicdata.model.ShareLinkFailure(
          ShareLinkFailureCode.NETWORK_FAILURE,
          "timeout",
        ),
      ),
    ))
    val result = NetEaseShareLinkResolver(transport).resolve("https://163cn.tv/bfxtWeE7")
    assertFailure(result, ShareLinkFailureCode.NETWORK_FAILURE)
  }

  private fun success(result: ShareLinkResult<NetEaseSharedResource>): NetEaseSharedResource =
    when (result) {
      is ShareLinkResult.Success -> result.data
      is ShareLinkResult.Failure -> error("Unexpected failure: ${result.error}")
    }

  private fun assertFailure(
    result: ShareLinkResult<*>,
    code: ShareLinkFailureCode,
    context: String? = null,
  ) {
    val failure = (result as ShareLinkResult.Failure).error
    assertEquals("${context ?: ""} 应失败为 $code，实际为 ${failure.code}", code, failure.code)
  }

  private class RecordingTransport(
    private val responses: Map<String, ShareLinkRedirectResult> = emptyMap(),
    private val default: ShareLinkRedirectResult = ShareLinkRedirectResult.NoRedirect,
  ) : ShareLinkRedirectTransport {
    val requestedHosts = mutableListOf<String>()

    override fun fetch(url: URI): ShareLinkRedirectResult {
      requestedHosts += url.host ?: ""
      return responses[url.host] ?: default
    }
  }
}
