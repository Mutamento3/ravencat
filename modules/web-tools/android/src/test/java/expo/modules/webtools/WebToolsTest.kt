package expo.modules.webtools

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketAddress
import java.net.SocketTimeoutException
import java.net.URI
import java.net.UnknownHostException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLHandshakeException
import javax.net.SocketFactory
import okhttp3.Dns
import okhttp3.HttpUrl.Companion.toHttpUrl

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

  @Test fun networkFailuresRetainCategoryCauseAndConnectionContextWithoutCredentials() {
    val url = "https://images.example.com/image?token=private-signature".toHttpUrl()
    val examples = listOf(
      UnknownHostException("Unable to resolve host images.example.com") to "WEB_DNS_FAILED",
      SocketTimeoutException("Read timed out") to "WEB_TIMEOUT",
      InterruptedIOException("timeout") to "WEB_TIMEOUT",
      SSLHandshakeException("certificate expired") to "WEB_TLS_FAILED",
      ConnectException("Connection refused") to "WEB_CONNECTION_FAILED",
      IOException("Connection reset") to "WEB_NETWORK_FAILED",
    )
    for ((error, code) in examples) {
      val failure = webNetworkFailure(error, url, "direct")
      assertEquals(code, failure.code)
      assertTrue(failure.message!!.contains(error.javaClass.simpleName))
      assertTrue(failure.message!!.contains(error.message!!))
      assertTrue(failure.message!!.contains("images.example.com"))
      assertTrue(failure.message!!.contains("直连"))
      assertFalse(failure.message!!.contains("private-signature"))
    }
    val error = IOException("fetch $url Bearer api-secret", SSLHandshakeException("certificate expired api-secret"))
    val failure = webNetworkFailure(error, url, "system", listOf("Bearer api-secret"))
    assertEquals("WEB_TLS_FAILED", failure.code)
    assertTrue(failure.message!!.contains("certificate expired"))
    assertTrue(failure.message!!.contains("跟随系统代理"))
    assertFalse(failure.message!!.contains("api-secret"))
    assertFalse(failure.message!!.contains("private-signature"))
  }

  @Test fun directModeIgnoresProxyAndSystemDirectKeepsPublicAddressBoundary() {
    var selections = 0
    val selector = object : ProxySelector() {
      override fun select(uri: URI): List<Proxy> { selections++; return listOf(Proxy.NO_PROXY) }
      override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) = Unit
    }
    var currentSelector: ProxySelector? = null
    val client = WebHttpClient { currentSelector }
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://localhost/", WebRequest("direct")) { true } }
    assertEquals(0, selections)
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://localhost/", WebRequest("system")) { true } }
    currentSelector = selector
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://localhost/", WebRequest("system")) { true } }
    assertEquals(1, selections)
  }

  @Test fun fakeIpRequiresVpnDnsAndNeverAllowsPrivateLiteralUrls() {
    for (ip in listOf("198.18.1.39", "198.19.255.254")) {
      val address = InetAddress.getByName(ip)
      assertFailure("WEB_VPN_FAKE_IP") { WebUrlPolicy.requireDnsTarget(address, false) }
      WebUrlPolicy.requireDnsTarget(address, true)
      assertFailure("WEB_PRIVATE_ADDRESS") { WebUrlPolicy.parse("https://$ip/image.png") }
    }
    for (ip in listOf("127.0.0.1", "10.0.0.1", "172.19.0.2", "192.168.1.1", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "fe80::1")) {
      assertFailure("WEB_PRIVATE_ADDRESS") { WebUrlPolicy.requireDnsTarget(InetAddress.getByName(ip), true) }
    }
    WebUrlPolicy.requireDnsTarget(InetAddress.getByName("1.1.1.1"), false)
    WebUrlPolicy.requireDnsTarget(InetAddress.getByName("1.1.1.1"), true)
  }

  @Test fun vpnOwnsBothDnsAndSocketAndCannotFallBackAfterDisconnect() {
    var addresses = listOf(InetAddress.getByName("198.18.1.39"))
    var socketCreated = false
    val sockets = object : SocketFactory() {
      override fun createSocket(): Socket { socketCreated = true; throw IOException("VPN 网络已断开") }
      override fun createSocket(host: String, port: Int): Socket = error("应先创建未连接的 socket")
      override fun createSocket(host: String, port: Int, local: InetAddress, localPort: Int): Socket = error("应先创建未连接的 socket")
      override fun createSocket(host: InetAddress, port: Int): Socket = error("应先创建未连接的 socket")
      override fun createSocket(host: InetAddress, port: Int, local: InetAddress, localPort: Int): Socket = error("应先创建未连接的 socket")
    }
    var route: WebVpnRoute? = WebVpnRoute(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> = addresses
    }, sockets)
    val selector = object : ProxySelector() {
      override fun select(uri: URI): List<Proxy> = listOf(Proxy.NO_PROXY)
      override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) = Unit
    }
    val client = WebHttpClient(vpnRoute = { route }, proxySelector = { selector })
    try {
      client.get("https://vpn-dns.invalid/image.png", WebRequest("system")) { fail("VPN 断开不能成功") }
      fail("预期 VPN 连接失败")
    } catch (failure: WebFailure) {
      assertEquals("WEB_NETWORK_FAILED", failure.code)
      assertTrue(failure.message!!.contains("VPN 网络已断开"))
    }
    assertTrue(socketCreated)
    socketCreated = false
    addresses = listOf(InetAddress.getByName("127.0.0.1"))
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://vpn-dns.invalid/", WebRequest("system")) { true } }
    assertFalse(socketCreated)
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://198.18.1.39/", WebRequest("system")) { true } }
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://localhost/", WebRequest("direct")) { true } }
    assertFalse(socketCreated)
    route = null
    assertFailure("WEB_PRIVATE_ADDRESS") { client.get("https://localhost/", WebRequest("system")) { true } }
    assertFalse(socketCreated)
  }

  @Test fun systemModeUsesLocalProxyWithoutResolvingTargetOrFallingBackToDirect() {
    val worker = Executors.newSingleThreadExecutor()
    ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
      val received = worker.submit<String> {
        server.accept().use { socket ->
          socket.soTimeout = 5000
          val input = socket.getInputStream().bufferedReader()
          val firstLine = input.readLine()
          while (input.readLine().isNotEmpty()) { /* 读完代理 CONNECT 请求头。 */ }
          socket.getOutputStream().write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
          firstLine
        }
      }
      val selector = object : ProxySelector() {
        override fun select(uri: URI): List<Proxy> = listOf(
          Proxy(Proxy.Type.HTTP, InetSocketAddress("127.0.0.1", server.localPort)), Proxy.NO_PROXY,
        )
        override fun connectFailed(uri: URI, address: SocketAddress, error: IOException) = Unit
      }
      try {
        WebHttpClient { selector }.get("https://target.invalid/image.png", WebRequest("system")) { fail("代理拒绝不能成功") }
        fail("预期代理连接失败")
      } catch (failure: WebFailure) {
        assertEquals("WEB_NETWORK_FAILED", failure.code)
        assertTrue(failure.message!!.contains("502"))
        assertTrue(failure.message!!.contains("target.invalid"))
      } finally {
        worker.shutdownNow()
      }
      assertEquals("CONNECT target.invalid:443 HTTP/1.1", received.get(5, TimeUnit.SECONDS))
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
