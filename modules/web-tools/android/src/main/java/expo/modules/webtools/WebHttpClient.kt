package expo.modules.webtools

import okhttp3.Call
import okhttp3.Dns
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
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
    .proxy(Proxy.NO_PROXY)
    .dns(object : Dns {
      override fun lookup(hostname: String): List<InetAddress> =
        // 返回的正是已校验的连接地址，避免校验后重新解析造成边界失效。
        Dns.SYSTEM.lookup(hostname).also { addresses -> addresses.forEach(WebUrlPolicy::requirePublic) }
    })
    .build()

  fun <T> get(value: String, request: WebRequest, download: Boolean = false, consume: (Response) -> T): T {
    var url = WebUrlPolicy.parse(value)
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(if (download) 120 else 60)
    val transport = if (download) client.newBuilder().callTimeout(120, TimeUnit.SECONDS).build() else client
    for (hop in 0..5) {
      request.checkActive()
      val call = transport.newCall(Request.Builder().url(url).header("User-Agent", "RavenCat/2.0").build())
      val remaining = deadline - System.nanoTime()
      if (remaining <= 0) throw WebFailure("WEB_NETWORK_FAILED", "网络请求已超时")
      call.timeout().timeout(remaining, TimeUnit.NANOSECONDS)
      request.attach(call)
      call.execute().use { response ->
        if (response.code in setOf(301, 302, 303, 307, 308)) {
          if (hop == 5) throw WebFailure("WEB_REDIRECT_LIMIT", "链接重定向次数过多")
          val location = response.header("Location") ?: throw WebFailure("WEB_INVALID_RESPONSE", "重定向缺少目标链接")
          url = WebUrlPolicy.parse(url.resolve(location)?.toString()
            ?: throw WebFailure("WEB_INVALID_RESPONSE", "重定向目标无效"))
        } else {
          if (!response.isSuccessful) throw WebFailure("WEB_HTTP_ERROR", "网站返回 HTTP ${response.code}")
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
