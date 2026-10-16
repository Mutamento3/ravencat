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
import java.net.InetAddress
import java.net.Proxy
import java.util.concurrent.TimeUnit

class WebFailure(val code: String, message: String) : RuntimeException(message)

/** 句柄先同步创建；网络连接与文件发布共享同一个取消线性化点。 */
class WebRequest {
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
}

class WebHttpClient {
  private val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(20, TimeUnit.SECONDS)
    .callTimeout(60, TimeUnit.SECONDS)
    .followRedirects(false)
    .followSslRedirects(false)
    .retryOnConnectionFailure(false)
    // 固定直连，使公网 DNS 校验作用于实际目标；不把目标解析交给代理绕过边界。
    // VPN/TUN 仍由系统路由处理，是否覆盖本应用由用户网络配置决定。
    .proxy(Proxy.NO_PROXY)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> =
        // 返回的正是已校验的连接地址，避免校验后重新解析造成边界失效。
        Dns.SYSTEM.lookup(hostname).also { addresses -> addresses.forEach(WebUrlPolicy::requirePublic) }
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
    val transport = if (download) client.newBuilder().callTimeout(120, TimeUnit.SECONDS).build() else client
    for (hop in 0..5) {
      request.checkActive()
      val builder = Request.Builder().url(url).header("User-Agent", "RavenCat/2.0")
      headers.forEach { (name, value) -> builder.header(name, value) }
      if (jsonBody != null) builder.post(jsonBody.toRequestBody("application/json; charset=utf-8".toMediaType()))
      val call = transport.newCall(builder.build())
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw WebFailure("WEB_NETWORK_FAILED", "网络请求已超时")
      call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
      request.attach(call)
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
    }
    error("重定向循环必须已经返回或抛错")
  }
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
