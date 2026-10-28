package expo.modules.webtools

import okhttp3.Call
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.io.IOException
import java.io.InterruptedIOException
import java.net.ConnectException
import java.net.InetAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import javax.net.SocketFactory
import javax.net.ssl.SSLException

class WebFailure(val code: String, message: String) : RuntimeException(message)

/** DNS 与 socket 必须绑定同一个系统确认的 VPN，断开后不能借用另一条网络继续连接。 */
data class WebVpnRoute(val dns: Dns, val socketFactory: SocketFactory)

/** 句柄先同步创建；网络连接与文件发布共享同一个取消线性化点。 */
class WebRequest(val connectionMode: String = "direct") {
  private var cancelled = false
  private var call: Call? = null

  @Synchronized fun checkActive() {
    if (cancelled) throw WebFailure("WEB_CANCELLED", "联网操作已取消")
  }

  @Synchronized fun attach(next: Call) {
    checkActive()
    call = next
  }

  @Synchronized fun cancel() {
    cancelled = true
    call?.cancel()
  }

  @Synchronized fun <T> publish(action: () -> T): T {
    checkActive()
    return action()
  }
}

object WebUrlPolicy {
  fun parse(value: String): HttpUrl {
    val url = value.toHttpUrlOrNull() ?: throw WebFailure("WEB_INVALID_URL", "链接不是有效的 HTTPS 地址")
    if (url.scheme != "https" || url.username.isNotEmpty() || url.password.isNotEmpty()) {
      throw WebFailure("WEB_INVALID_URL", "只支持不含登录凭据的公开 HTTPS 链接")
    }
    // IP 字面量不经过 OkHttp Dns；域名则在真正解析并连接时裁决。
    if (url.host.contains(':') || url.host.all { it.isDigit() || it == '.' }) {
      requirePublic(InetAddress.getByName(url.host))
    }
    return url
  }

  fun requirePublic(address: InetAddress) {
    val bytes = address.address.map { it.toInt() and 255 }
    val reservedV4 = bytes.size == 4 && (
      bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127 || bytes[0] >= 224 ||
        (bytes[0] == 100 && bytes[1] in 64..127) ||
        (bytes[0] == 169 && bytes[1] == 254) ||
        (bytes[0] == 172 && bytes[1] in 16..31) ||
        (bytes[0] == 192 && bytes[1] == 168) ||
        (bytes[0] == 198 && bytes[1] in 18..19)
      )
    val privateV6 = bytes.size == 16 && (bytes[0] and 254) == 252
    if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
      address.isSiteLocalAddress || address.isMulticastAddress || reservedV4 || privateV6) {
      throw WebFailure("WEB_PRIVATE_ADDRESS", "联网工具只访问公网，不访问本机或内网地址")
    }
  }

  fun requireDnsTarget(address: InetAddress, vpnRoute: Boolean) {
    val bytes = address.address.map { it.toInt() and 255 }
    if (bytes.size == 4 && bytes[0] == 198 && bytes[1] in 18..19) {
      if (vpnRoute) return
      throw WebFailure("WEB_VPN_FAKE_IP", "DNS 返回 VPN Fake-IP ${address.hostAddress}，当前请求未使用 VPN 路由；请开启系统代理并检查 VPN 是否接管本应用")
    }
    requirePublic(address)
  }
}

class WebHttpClient(
  private val vpnRoute: () -> WebVpnRoute? = { null },
  private val proxySelector: () -> ProxySelector? = { ProxySelector.getDefault() },
) {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(60, TimeUnit.SECONDS)
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    // 直连时 DNS 校验必须裁决实际连接地址；VPN/TUN 仍由系统路由处理。
    .proxy(Proxy.NO_PROXY)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> =
        // 返回的正是已校验的连接地址，避免校验后重新解析造成边界失效。
        Dns.SYSTEM.lookup(hostname).also { addresses -> addresses.forEach { WebUrlPolicy.requireDnsTarget(it, false) } }
    })
    .build()

  fun <T> get(value: String, request: WebRequest, download: Boolean = false, consume: (Response) -> T): T {
    return execute(value, request, download, emptyMap(), null, consume)
  }

  fun <T> searchApi(value: String, request: WebRequest, headers: Map<String, String>, jsonBody: String? = null, consume: (Response) -> T): T {
    return execute(value, request, false, headers, jsonBody, consume)
  }

  private fun <T> execute(value: String, request: WebRequest, download: Boolean, headers: Map<String, String>, jsonBody: String?, consume: (Response) -> T): T {
    var url = WebUrlPolicy.parse(value)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(if (download) 120 else 60)
    for (hop in 0..5) {
      request.checkActive()
      // 系统选择器拥有代理与排除规则；只采用首选路由，失败不偷偷切回直连。
      val proxy = when (request.connectionMode) {
        "direct" -> Proxy.NO_PROXY
        "system" -> proxySelector()?.select(url.toUri())?.first() ?: Proxy.NO_PROXY
        else -> error("未知联网连接方式：${request.connectionMode}")
      }
      val vpn = if (request.connectionMode == "system" && proxy.type() == Proxy.Type.DIRECT) vpnRoute() else null
      // 代理端点属于用户系统配置，可以是本机或局域网；目标域名的解析与地址裁决交由可信代理。
      // VPN 只承接其 DNS 返回的 Fake-IP，其他内网地址仍拒绝；没有 VPN 时保留严格公网边界。
      val dns = when {
        proxy.type() != Proxy.Type.DIRECT -> Dns.SYSTEM
        vpn != null -> object : Dns {
          override fun lookup(hostname: String): List<InetAddress> =
            vpn.dns.lookup(hostname).also { addresses -> addresses.forEach { WebUrlPolicy.requireDnsTarget(it, true) } }
        }
        else -> client.dns
      }
      val transportBuilder = client.newBuilder().proxy(proxy).dns(dns)
        .callTimeout(if (download) 120 else 60, TimeUnit.SECONDS)
      if (vpn != null) transportBuilder.socketFactory(vpn.socketFactory)
      val transport = transportBuilder.build()
      val builder = Request.Builder().url(url).header("User-Agent", "RavenCat/2.0")
      headers.forEach { (name, value) -> builder.header(name, value) }
      if (jsonBody != null) builder.post(jsonBody.toRequestBody("application/json; charset=utf-8".toMediaType()))
      val call = transport.newCall(builder.build())
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw webNetworkFailure(SocketTimeoutException("请求总时限已耗尽"), url, request.connectionMode, headers.values)
      call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
      request.attach(call)
      try {
        call.execute().use { response ->
          if (response.code in setOf(301, 302, 303, 307, 308)) {
            // 带密钥的官方 API 不允许重定向，避免凭据或 POST 正文被转交给另一目标。
            if (headers.isNotEmpty() || jsonBody != null) throw WebFailure("WEB_API_REDIRECT", "搜索服务返回了不允许的重定向")
            if (hop == 5) throw WebFailure("WEB_REDIRECT_LIMIT", "链接重定向次数过多")
            val location = response.header("Location") ?: throw WebFailure("WEB_INVALID_RESPONSE", "重定向缺少目标链接")
            url = WebUrlPolicy.parse(url.resolve(location)?.toString()
              ?: throw WebFailure("WEB_INVALID_RESPONSE", "重定向目标无效"))
          } else {
            if (!response.isSuccessful) {
              val code = when {
                headers.isNotEmpty() && response.code in setOf(401, 403) -> "WEB_API_AUTH_FAILED"
                headers.isNotEmpty() && response.code in setOf(402, 432, 433) -> "WEB_API_QUOTA_EXCEEDED"
                response.code == 429 -> "WEB_RATE_LIMITED"
                else -> "WEB_HTTP_ERROR"
              }
              val message = when (code) {
                "WEB_API_AUTH_FAILED" -> "搜索服务拒绝访问，请检查密钥和账号权限"
                "WEB_API_QUOTA_EXCEEDED" -> "搜索服务额度或用量上限已耗尽"
                "WEB_RATE_LIMITED" -> "搜索来源暂时限流，可稍后再试或选择其他已启用来源"
                else -> "网站返回 HTTP ${response.code}"
              }
              throw WebFailure(code, message)
            }
            request.checkActive()
            return consume(response)
          }
        }
      } catch (error: IOException) {
        request.checkActive()
        throw webNetworkFailure(error, url, request.connectionMode, headers.values)
      }
    }
    error("重定向循环必须已经返回或抛错")
  }
}

/** 网络边界只保留异常事实，不根据连接错误猜测源站状态，也不暴露 URL 参数和搜索密钥。 */
internal fun webNetworkFailure(error: IOException, url: HttpUrl, connectionMode: String, secrets: Collection<String> = emptyList()): WebFailure {
  val causes = generateSequence<Throwable>(error) { it.cause }.toList()
  val (code, reason) = when {
    causes.any { it is UnknownHostException } -> "WEB_DNS_FAILED" to "DNS 解析失败"
    causes.any { it is SocketTimeoutException || it is InterruptedIOException && it.message?.contains("timeout", ignoreCase = true) == true } -> "WEB_TIMEOUT" to "网络请求超时"
    causes.any { it is SSLException } -> "WEB_TLS_FAILED" to "TLS 安全连接失败"
    causes.any { it is ConnectException } -> "WEB_CONNECTION_FAILED" to "网络连接失败"
    else -> "WEB_NETWORK_FAILED" to "网络读写失败"
  }
  var detail = causes.joinToString("；原因：") { cause ->
    if (cause.message.isNullOrBlank()) cause.javaClass.simpleName else "${cause.javaClass.simpleName}: ${cause.message}"
  }
  for (secret in secrets) {
    detail = detail.replace(secret, "[已隐藏]")
    if (secret.startsWith("Bearer ")) detail = detail.replace(secret.removePrefix("Bearer "), "[已隐藏]")
  }
  detail = detail.replace(Regex("https?://[^\\s<>\\\"']+")) { match ->
    match.value.toHttpUrlOrNull()?.let { "${it.scheme}://${it.host}/[路径及参数已隐藏]" } ?: "[链接已隐藏]"
  }
  val mode = if (connectionMode == "direct") "直连" else "跟随系统代理"
  return WebFailure(code, "$reason（目标：${url.host}；连接方式：$mode）。$detail")
}

/** 同时限制解压后的实际字节数，不能只信任外部 Content-Length。 */
fun copyWebBody(input: InputStream, output: OutputStream, maxBytes: Long, request: WebRequest): Long {
  val buffer = ByteArray(16 * 1024)
  var size = 0L
  while (true) {
    request.checkActive()
    val read = input.read(buffer)
    if (read == -1) break
    size += read
    if (size > maxBytes) throw WebFailure("WEB_TOO_LARGE", "内容超过工具允许的大小")
    output.write(buffer, 0, read)
  }
  request.checkActive()
  return size
}

fun readWebBody(response: Response, maxBytes: Long, request: WebRequest): ByteArray {
  val body = response.body ?: throw WebFailure("WEB_INVALID_RESPONSE", "网站未返回内容")
  if (body.contentLength() > maxBytes) throw WebFailure("WEB_TOO_LARGE", "内容超过工具允许的大小")
  return ByteArrayOutputStream().use { output ->
    body.byteStream().use { input -> copyWebBody(input, output, maxBytes, request) }
    output.toByteArray()
  }
}
