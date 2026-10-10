package expo.modules.webtools

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.InetAddress

class WebToolsTest {
  @Test fun searchRetainsSourcesAndLimitsResults() {
    val xml = """<rss><channel>
      <item><title>资料 &amp; 来源</title><link>https://example.com/one</link><description><![CDATA[<b>摘要</b>]]></description></item>
      <item><title>重复</title><link>https://example.com/one</link></item>
      <item><title>HTTP 来源</title><link>http://example.com/two</link></item>
    </channel></rss>"""
    val result = WebContentParser.search(xml, "资料", 2)
    val items = result.getValue("items") as List<*>
    assertEquals(2, items.size)
    assertEquals("摘要", (items.first() as Map<*, *>)["snippet"])
    assertEquals("http://example.com/two", (items.last() as Map<*, *>)["url"])
    assertEquals(1, (WebContentParser.search(xml, "资料", 1)["items"] as List<*>).size)
  }

  @Test fun challengeIsAnErrorAndEmptyChannelIsARealEmptyResult() {
    assertFailure("WEB_SEARCH_UNAVAILABLE") { WebContentParser.search("<html>captcha</html>", "资料", 5) }
    assertEquals(emptyList<Any>(), WebContentParser.search("<rss><channel/></rss>", "无结果", 5)["items"])
  }

  @Test fun pageExtractsReadableContentAndReportsTruncation() {
    val html = """<html><head><title>标题</title><style>bad</style></head><body>
      <nav>导航</nav><main><p>第一段资料。</p><script>bad()</script><p>第二段资料。</p>
      <a href="/source">来源</a><a href="javascript:alert(1)">坏链接</a></main><footer>页脚</footer></body></html>"""
    val page = WebContentParser.page(html.toByteArray(), "UTF-8", "https://example.com/page", "text/html", 8)
    assertEquals("标题", page["title"])
    assertEquals(true, page["truncated"])
    val text = page["text"] as String
    assertEquals(8, text.length)
    assertFalse(text.contains("bad"))
    assertFalse(text.contains("导航"))
    val links = page["links"] as List<*>
    assertEquals(1, links.size)
    assertEquals("https://example.com/source", (links.first() as Map<*, *>)["url"])
  }

  @Test fun binaryIsNotPresentedAsPageText() {
    assertFailure("WEB_UNSUPPORTED_CONTENT") {
      WebContentParser.page(byteArrayOf(1), null, "https://example.com/doc.pdf", "application/pdf", 1000)
    }
    assertEquals("正文", WebContentParser.page("正文".toByteArray(), "UTF-8", "https://example.com/doc", "text/plain", 1000)["text"])
  }

  @Test fun namesCannotChooseDirectoriesAndPreserveExtensions() {
    assertEquals("报告-a.pdf", WebContentParser.fileName(null, "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf", "https://example.com/file", "a"))
    assertEquals("x+y-b.txt", WebContentParser.fileName(null, null, "https://example.com/x+y.txt", "b"))
    assertEquals("%report-b.pdf", WebContentParser.fileName(null, null, "https://example.com/%25report.pdf", "b"))
    assertEquals("chosen-b.pdf", WebContentParser.fileName("chosen.pdf", "attachment; filename*=UTF-8''%oops", "https://example.com/file", "b"))
    val name = WebContentParser.fileName("../../test.pdf", null, "https://example.com/file", "c")
    assertFalse(name.contains('/'))
    assertFalse(name.contains('\\'))
    assertTrue(name.endsWith("-c.pdf"))
    assertNotEquals(name, WebContentParser.fileName("../../test.pdf", null, "https://example.com/file", "d"))
    val longName = WebContentParser.fileName("文".repeat(120) + ".pdf", null, "https://example.com/file", "unique")
    assertTrue(longName.toByteArray().size < 255)
    assertTrue(longName.endsWith("-unique.pdf"))
  }

  @Test fun publicNetworkBoundaryRejectsUnsafeSchemesCredentialsAndPrivateAddresses() {
    for (url in listOf("http://example.com", "file:///tmp/test", "https://user:pass@example.com")) {
      assertFailure("WEB_INVALID_URL") { WebUrlPolicy.parse(url) }
    }
    for (ip in listOf("127.0.0.1", "10.0.0.1", "172.16.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1")) {
      assertFailure("WEB_PRIVATE_ADDRESS") { WebUrlPolicy.requirePublic(InetAddress.getByName(ip)) }
    }
    WebUrlPolicy.requirePublic(InetAddress.getByName("1.1.1.1"))
    WebUrlPolicy.requirePublic(InetAddress.getByName("2606:4700:4700::1111"))
  }

  @Test fun actualStreamSizeIsBoundedEvenWithoutContentLength() {
    val output = ByteArrayOutputStream()
    assertEquals(4L, copyWebBody(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4)), output, 4, WebRequest()))
    assertFailure("WEB_TOO_LARGE") {
      copyWebBody(ByteArrayInputStream(byteArrayOf(1, 2, 3, 4, 5)), ByteArrayOutputStream(), 4, WebRequest())
    }
  }

  @Test fun cancelledRequestCannotPublishOrRead() {
    val request = WebRequest()
    request.cancel()
    var published = false
    assertFailure("WEB_CANCELLED") { request.publish { published = true } }
    assertFalse(published)
    assertFailure("WEB_CANCELLED") {
      copyWebBody(ByteArrayInputStream(byteArrayOf(1)), ByteArrayOutputStream(), 4, request)
    }
  }

  private fun assertFailure(code: String, action: () -> Any?) {
    try {
      action()
      fail("预期失败：$code")
    } catch (error: WebFailure) {
      assertEquals(code, error.code)
    }
  }
}
