package expo.modules.webtools

import org.junit.Assert.*
import org.junit.Test

class WebSearchResultsTest {
  @Test fun deduplicationPreservesBusinessParametersAndMergesEvidence() {
    val items = listOf(
      mapOf("title" to "原文", "url" to "https://example.com/doc?id=1&utm_source=a#part", "snippet" to "第一段"),
      mapOf("title" to "同页", "url" to "https://example.com/doc?id=1&utm_source=b", "snippet" to "第二段"),
      mapOf("title" to "另一个页面", "url" to "https://example.com/doc?id=2", "snippet" to "其他"),
      mapOf("title" to "原文", "url" to "https://other.example/doc?id=1", "snippet" to "转载")
    )
    val result = WebSearchResults.finish("bing", "Bing RSS", "资料", items, 10)
    val unique = result["items"] as List<*>
    assertEquals(3, unique.size)
    assertEquals(1, result["duplicatesRemoved"])
    assertEquals("第一段\n第二段", (unique.first() as Map<*, *>)["snippet"])
    assertEquals("https://example.com/doc?id=1&utm_source=a#part", (unique.first() as Map<*, *>)["url"])
    assertEquals(1, (WebSearchResults.finish("bing", "Bing RSS", "资料", items, 1)["items"] as List<*>).size)
  }

  @Test fun duckDuckGoUnwrapsSourcesAndRejectsChallenges() {
    val html = """<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdoc%3Fid%3D1">资料</a><span class="result__snippet">摘要</span></div>
      <div class="result result--ad"><a class="result__a" href="https://advert.example/">广告</a></div>"""
    val result = WebSearchResults.duckDuckGo(html, "资料", 5)
    val items = result["items"] as List<*>
    assertEquals(1, items.size)
    assertEquals("https://example.com/doc?id=1", (items.first() as Map<*, *>)["url"])
    assertEquals("duckduckgo", result["engine"])
    assertFailure("WEB_SEARCH_UNAVAILABLE") { WebSearchResults.duckDuckGo("<form id='challenge-form'>验证码</form>", "资料", 5) }
    assertFailure("WEB_SEARCH_UNAVAILABLE") { WebSearchResults.duckDuckGo("<html>登录或新的页面结构</html>", "资料", 5) }
    assertEquals(emptyList<Any>(), WebSearchResults.duckDuckGo("<div class='no-results'>没有结果</div>", "资料", 5)["items"])
  }

  @Test fun apiResponsesRetainUsefulMetadataAndRejectMalformedResults() {
    val tavily = WebSearchResults.tavily("""{"results":[{"title":"资料","url":"https://example.com/","content":"相关片段","score":0.9,"published_date":"2026-10-16"}]}""", "资料", 5, false)
    val item = (tavily["items"] as List<*>).first() as Map<*, *>
    assertEquals(0.9, item["score"])
    assertEquals("2026-10-16", item["publishedAt"])
    val brave = WebSearchResults.brave("""{"query":{"original":"资料"},"web":{"results":[{"title":"资料","url":"https://example.com/","description":"摘要","extra_snippets":["额外片段"]}]}}""", "资料", 5)
    assertTrue(((brave["items"] as List<*>).first() as Map<*, *>)["snippet"].toString().contains("额外片段"))
    assertEquals(emptyList<Any>(), WebSearchResults.brave("""{"query":{"original":"无结果"}}""", "无结果", 5)["items"])
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("<html>error</html>", "资料", 5, false) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[{"url":"https://example.com"}]}""", "资料", 5, false) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.brave("""{"error":{"message":"invalid key"}}""", "资料", 5) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.brave("""{"query":{},"web":"broken"}""", "资料", 5) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[{"title":"资料","url":"javascript:alert(1)","content":"片段"}]}""", "资料", 5, false) }
  }

  @Test fun tavilyImagesRetainDownloadUrlsDescriptionsAndSourcePages() {
    val json = """{"results":[{"title":"鲸鱼","url":"https://example.com/whales","content":"网页摘要","images":[
      {"url":"https://images.example.com/whale.jpg?w=1200&sig=first","description":"逐页描述"},
      {"url":"https://images.example.com/whale.jpg?w=800&sig=second","description":"另一尺寸"}
    ]}],"images":[
      {"url":"https://images.example.com/whale.jpg?w=1200&sig=first","description":"<b>鲸鱼</b>跃出水面"},
      {"url":"https://images.example.com/ocean.jpg","description":"海面"}
    ]}"""
    val result = WebSearchResults.tavily(json, "鲸鱼", 5, true)
    val images = result["images"] as List<*>
    assertEquals(3, images.size)
    val first = images[0] as Map<*, *>
    assertEquals("https://images.example.com/whale.jpg?w=1200&sig=first", first["url"])
    assertEquals("鲸鱼跃出水面", first["description"])
    assertEquals("https://example.com/whales", first["sourceUrl"])
    assertEquals("https://images.example.com/whale.jpg?w=800&sig=second", (images[2] as Map<*, *>)["url"])
    assertEquals(1, (result["items"] as List<*>).size)
    assertEquals(1, (WebSearchResults.tavily(json, "鲸鱼", 1, true)["images"] as List<*>).size)
    assertFalse(WebSearchResults.tavily(json, "鲸鱼", 5, false).containsKey("images"))
  }

  @Test fun tavilyImagesDistinguishEmptyResultsFromMalformedResponses() {
    assertEquals(emptyList<Any>(), WebSearchResults.tavily("""{"results":[],"images":[]}""", "鲸鱼", 5, true)["images"])
    val imageOnly = WebSearchResults.tavily("""{"results":[],"images":[{"url":"https://example.com/image.jpg","description":"鲸鱼"}]}""", "鲸鱼", 5, true)
    assertEquals(1, (imageOnly["images"] as List<*>).size)
    assertEquals(emptyList<Any>(), imageOnly["items"])
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[]}""", "鲸鱼", 5, true) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[],"images":"broken"}""", "鲸鱼", 5, true) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[],"images":[{"url":"javascript:alert(1)","description":"鲸鱼"}]}""", "鲸鱼", 5, true) }
    assertFailure("WEB_INVALID_RESPONSE") { WebSearchResults.tavily("""{"results":[],"images":[{"description":"鲸鱼"}]}""", "鲸鱼", 5, true) }
  }

  @Test fun pageCanContinueLocateAndDetectChangedContent() {
    val original = "开头资料。".repeat(100) + "目标关键词" + "结尾资料。".repeat(200)
    val first = WebPageText.window(original, 300, 0, null, null)
    val version = first["documentVersion"] as String
    assertEquals(300, first["nextStartChar"])
    val second = WebPageText.window(original, 300, 300, null, version)
    assertEquals(original.substring(0, 600), (first["text"] as String) + second["text"])
    val found = WebPageText.window(original, 400, 0, "目标关键词", version)
    assertTrue((found["text"] as String).contains("目标关键词"))
    assertEquals(1, (found["matches"] as List<*>).size)
    assertEquals("", WebPageText.window(original, 300, 0, "不存在", version)["text"])
    assertEquals(null, WebPageText.window(original, 300, original.length, null, version)["nextStartChar"])
    assertFailure("WEB_PAGE_CHANGED") { WebPageText.window(original + "更新", 300, 300, null, version) }
    assertFailure("WEB_OFFSET_OUT_OF_RANGE") { WebPageText.window(original, 300, original.length + 1, null, version) }
  }

  @Test fun pageRetainsHeadingsListsLinksTablesAndCode() {
    val html = """<main><h2>标题</h2><ul><li>条目</li></ul><a href="/doc">来源</a><table><tr><th>名称</th><th>值</th></tr><tr><td>A</td><td>1</td></tr></table><pre>  code
  next</pre></main>"""
    val page = WebContentParser.page(html.toByteArray(), "UTF-8", "https://example.com/", "text/html", 2000)
    val text = page["text"] as String
    assertTrue(text, text.contains("## 标题"))
    assertTrue(text, text.contains("- 条目"))
    assertTrue(text, text.contains("[来源](https://example.com/doc)"))
    assertTrue(text, text.contains("| A | 1 |"))
    assertTrue(text, text.contains("  code\n  next"))
  }

  @Test fun deeplyNestedExternalMarkupDoesNotConsumeTheCallStack() {
    val html = "<main>" + "<div>".repeat(5000) + "深层正文" + "</div>".repeat(5000) + "</main>"
    assertEquals("深层正文", WebContentParser.page(html.toByteArray(), "UTF-8", "https://example.com/", "text/html", 2000)["text"])
  }

  private fun assertFailure(code: String, action: () -> Any?) {
    try { action(); fail("预期失败：$code") }
    catch (error: WebFailure) { assertEquals(code, error.code) }
  }
}
