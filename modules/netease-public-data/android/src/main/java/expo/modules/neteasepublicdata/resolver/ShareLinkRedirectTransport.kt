package expo.modules.neteasepublicdata.resolver

import expo.modules.neteasepublicdata.model.ShareLinkFailure
import expo.modules.neteasepublicdata.model.ShareLinkFailureCode
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

/**
 * 只返回 redirect 头信息，不返回响应正文。
 *
 * [ShareLinkRedirectResult.Redirect.location] 保留服务端返回的原始 Location 字符串（可能是相对地址），
 * 由 resolver 负责 relative resolve + scheme/host 校验。
 */
sealed interface ShareLinkRedirectResult {
  data class Redirect(val location: String?) : ShareLinkRedirectResult
  data object NoRedirect : ShareLinkRedirectResult
  data class Failure(val failure: ShareLinkFailure) : ShareLinkRedirectResult
}

fun interface ShareLinkRedirectTransport {
  fun fetch(url: URI): ShareLinkRedirectResult
}

/**
 * 真实 HTTPS redirect 探测：manual redirect（不自动跟随），只读 status + Location，不读 body，
 * 不携带 Cookie / Authorization / MUSIC_U / MUSIC_A。
 */
class HttpsShareLinkRedirectTransport : ShareLinkRedirectTransport {
  companion object {
    private const val TIMEOUT_MS = 15_000
    private const val USER_AGENT = "RavenCat/1.0"
    private val HEAD_UNSUPPORTED = setOf(405, 501)
    private val REDIRECT_CODES = setOf(301, 302, 303, 307, 308)
  }

  override fun fetch(url: URI): ShareLinkRedirectResult {
    val head = request(url, "HEAD")
    // 目标服务不支持 HEAD 时降级为 GET，但仍只读头、不读 body、不跟随重定向。
    if (head is HttpResult.Ok && head.status in HEAD_UNSUPPORTED) {
      return toRedirectResult(request(url, "GET"))
    }
    return toRedirectResult(head)
  }

  private fun toRedirectResult(result: HttpResult): ShareLinkRedirectResult = when (result) {
    is HttpResult.Ok -> {
      val location = result.location
      if (result.status in REDIRECT_CODES) {
        ShareLinkRedirectResult.Redirect(location)
      } else {
        ShareLinkRedirectResult.NoRedirect
      }
    }
    is HttpResult.Failed -> ShareLinkRedirectResult.Failure(result.failure)
  }

  private fun request(url: URI, method: String): HttpResult {
    val connection = try {
      url.toURL().openConnection() as HttpURLConnection
    } catch (error: IOException) {
      return HttpResult.Failed(networkFailure(error))
    }
    return try {
      connection.requestMethod = method
      // manual redirect：绝对不允许 HttpURLConnection 自动跟随。
      connection.instanceFollowRedirects = false
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      connection.setRequestProperty("User-Agent", USER_AGENT)
      val status = connection.responseCode
      val location = connection.getHeaderField("Location")
      HttpResult.Ok(status, location)
    } catch (error: IOException) {
      HttpResult.Failed(networkFailure(error))
    } finally {
      connection.disconnect()
    }
  }

  private fun networkFailure(error: IOException) = ShareLinkFailure(
    ShareLinkFailureCode.NETWORK_FAILURE,
    error.message ?: error.javaClass.simpleName,
  )

  private sealed interface HttpResult {
    data class Ok(val status: Int, val location: String?) : HttpResult
    data class Failed(val failure: ShareLinkFailure) : HttpResult
  }
}
