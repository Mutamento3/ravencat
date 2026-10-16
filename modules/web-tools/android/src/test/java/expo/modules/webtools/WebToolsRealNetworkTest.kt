package expo.modules.webtools

import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test

/** 显式开启的真实来源探针；不把互联网可用性变成离线单测要求。 */
class WebToolsRealNetworkTest {
  @Test fun duckDuckGoReturnsSourcesOrAnExplicitUpstreamFailure() {
    assumeTrue(System.getProperty("webTools.realNetwork") == "true")
    try {
      val result = WebSearchClient(WebHttpClient()).search("duckduckgo", "jsoup HTML parser", 5, null, "basic", null, WebRequest())
      assertTrue((result["items"] as List<*>).isNotEmpty())
    } catch (failure: WebFailure) {
      // 真实探针保留上游拒绝原因；不把验证码包装成成功验收。
      throw AssertionError("DuckDuckGo 探针：${failure.code} ${failure.message}", failure)
    }
  }
  @Test fun searchAndReadPublicPage() {
    assumeTrue(System.getProperty("webTools.realNetwork") == "true")
    val client = WebHttpClient()
    val request = WebRequest()
    val search = client.get("https://www.bing.com/search?format=rss&q=MediaStore", request) { response ->
      WebContentParser.search(String(readWebBody(response, 1024L * 1024, request), Charsets.UTF_8), "MediaStore", 5)
    }
    assertTrue((search["items"] as List<*>).isNotEmpty())
    val page = client.get("https://jsoup.org/", request) { response ->
      WebContentParser.page(readWebBody(response, 2L * 1024 * 1024, request), null,
        response.request.url.toString(), "text/html", 12000)
    }
    assertTrue(page.toString(), (page["title"] as String).lowercase().contains("jsoup"))
    assertTrue(page.toString(), (page["text"] as String).contains("HTML"))
  }
}
