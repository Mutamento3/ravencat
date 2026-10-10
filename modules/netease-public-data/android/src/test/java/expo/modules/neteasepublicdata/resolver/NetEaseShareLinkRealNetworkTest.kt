package expo.modules.neteasepublicdata.resolver

import expo.modules.neteasepublicdata.model.NetEaseSharedResource
import expo.modules.neteasepublicdata.model.ShareLinkResult
import org.junit.Assert.assertEquals
import org.junit.Assume.assumeTrue
import org.junit.Test

/** 显式 opt-in 的真实网络验证；默认 unit test 不访问外部网络。 */
class NetEaseShareLinkRealNetworkTest {
  @Test
  fun `production resolver resolves real short link to song identity`() {
    assumeTrue(System.getProperty("netease.realNetwork") == "true")

    val resolver = NetEaseShareLinkResolver(HttpsShareLinkRedirectTransport())
    val result = resolver.resolve("https://163cn.tv/bfxtWeE7")

    assertEquals(
      NetEaseSharedResource.Song(2657785221),
      (result as ShareLinkResult.Success).data,
    )
  }

  @Test
  fun `production resolver keeps direct canonical URLs stable`() {
    assumeTrue(System.getProperty("netease.realNetwork") == "true")

    val resolver = NetEaseShareLinkResolver(HttpsShareLinkRedirectTransport())
    assertEquals(
      NetEaseSharedResource.Song(2657785221),
      (resolver.resolve("https://music.163.com/song?id=2657785221") as ShareLinkResult.Success).data,
    )
    assertEquals(
      NetEaseSharedResource.Playlist(4925292),
      (resolver.resolve("https://music.163.com/playlist?id=4925292") as ShareLinkResult.Success).data,
    )
  }
}
