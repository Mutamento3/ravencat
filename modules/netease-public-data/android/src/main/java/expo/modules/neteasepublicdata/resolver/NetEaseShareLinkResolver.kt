package expo.modules.neteasepublicdata.resolver

import expo.modules.neteasepublicdata.model.NetEaseSharedResource
import expo.modules.neteasepublicdata.model.ShareLinkFailure
import expo.modules.neteasepublicdata.model.ShareLinkFailureCode
import expo.modules.neteasepublicdata.model.ShareLinkResult
import java.net.URI

/**
 * NetEase official share URL → stable resource identity。
 *
 * 首版只承诺 song / playlist；其他资源返回 unsupported_resource_type。
 *
 * ```text
 * NetEase official share URL
 *   → strict URL validation（HTTPS only + exact host allowlist）
 *   → bounded / manual redirect resolution（max 5，每跳重新校验）
 *   → resource type + stable numeric ID
 * ```
 */
class NetEaseShareLinkResolver(private val transport: ShareLinkRedirectTransport) {
  companion object {
    const val MAX_REDIRECTS = 5
    private val ALLOWED_HOSTS = setOf(
      "163cn.tv",
      "music.163.com",
      "y.music.163.com",
    )
    /** identity 只从 canonical 主机解析；`163cn.tv` 是纯短链，不承载资源身份。 */
    private val CANONICAL_HOSTS = setOf(
      "music.163.com",
      "y.music.163.com",
    )
  }

  fun resolve(input: String): ShareLinkResult<NetEaseSharedResource> {
    val initial = validateUrl(input)
    if (initial is ShareLinkResult.Failure) return initial

    var current = (initial as ShareLinkResult.Success).data
    var redirects = 0
    while (true) {
      // 每一跳先尝试从 canonical 主机解析 identity；direct URL 无需网络即可命中。
      val host = current.host?.lowercase()
      val identity = if (host != null && host in CANONICAL_HOSTS) {
        NetEaseShareIdentity.parse(current)
      } else {
        IdentityOutcome.NotRecognized
      }
      when (identity) {
        is IdentityOutcome.Parsed -> return ShareLinkResult.Success(identity.resource)
        is IdentityOutcome.UnsupportedType -> return ShareLinkResult.Failure(ShareLinkFailure(
          ShareLinkFailureCode.UNSUPPORTED_RESOURCE_TYPE,
          "首版不支持该资源类型：${identity.type}",
        ))
        is IdentityOutcome.InvalidId -> return ShareLinkResult.Failure(ShareLinkFailure(
          ShareLinkFailureCode.INVALID_RESOURCE_ID,
          identity.detail,
        ))
        is IdentityOutcome.NotRecognized -> Unit
      }

      if (redirects >= MAX_REDIRECTS) {
        return ShareLinkResult.Failure(ShareLinkFailure(
          ShareLinkFailureCode.TOO_MANY_REDIRECTS,
          "重定向超过 $MAX_REDIRECTS 跳上限",
        ))
      }

      when (val result = transport.fetch(current)) {
        is ShareLinkRedirectResult.Redirect -> {
          val next = resolveHop(current, result.location)
          if (next is ShareLinkResult.Failure) return next
          current = (next as ShareLinkResult.Success).data
          redirects += 1
        }
        is ShareLinkRedirectResult.NoRedirect -> return ShareLinkResult.Failure(ShareLinkFailure(
          ShareLinkFailureCode.UNRESOLVABLE_SHARE_LINK,
          "链接未指向可解析的网易云资源",
        ))
        is ShareLinkRedirectResult.Failure -> return ShareLinkResult.Failure(result.failure)
      }
    }
  }

  /**
   * 每一跳都必须重新过 scheme + exact host allowlist，不能只校验初始与最终 URL。
   * 否则会形成「合法网易云短链 → 恶意第三方 redirect → 请求任意地址」的 SSRF。
   */
  private fun resolveHop(base: URI, location: String?): ShareLinkResult<URI> {
    if (location.isNullOrBlank()) {
      return ShareLinkResult.Failure(ShareLinkFailure(
        ShareLinkFailureCode.REDIRECT_REJECTED,
        "重定向缺少 Location",
      ))
    }
    val target = try {
      base.resolve(location)
    } catch (_: IllegalArgumentException) {
      return ShareLinkResult.Failure(ShareLinkFailure(
        ShareLinkFailureCode.REDIRECT_REJECTED,
        "重定向 Location 无法解析",
      ))
    }
    val violation = validateSchemeAndHost(target)
    return if (violation == null) {
      ShareLinkResult.Success(target)
    } else {
      ShareLinkResult.Failure(ShareLinkFailure(
        ShareLinkFailureCode.REDIRECT_REJECTED,
        "重定向目标未通过 scheme / host 校验：${violation.message}",
      ))
    }
  }

  private fun validateUrl(input: String): ShareLinkResult<URI> {
    if (input.isBlank()) {
      return ShareLinkResult.Failure(ShareLinkFailure(
        ShareLinkFailureCode.INVALID_URL,
        "链接为空",
      ))
    }
    val uri = try {
      URI(input)
    } catch (_: Exception) {
      return ShareLinkResult.Failure(ShareLinkFailure(
        ShareLinkFailureCode.INVALID_URL,
        "不是合法 URL",
      ))
    }
    val violation = validateSchemeAndHost(uri)
    return if (violation == null) {
      ShareLinkResult.Success(uri)
    } else {
      ShareLinkResult.Failure(violation)
    }
  }

  /** 返回 null 表示通过；返回 failure 表示违反了 scheme / host / 端口 / userinfo 边界。 */
  private fun validateSchemeAndHost(uri: URI): ShareLinkFailure? {
    if (uri.scheme == null || !uri.scheme.equals("https", ignoreCase = true)) {
      return ShareLinkFailure(ShareLinkFailureCode.INVALID_URL, "只接受 HTTPS 链接")
    }
    val host = uri.host
    if (host.isNullOrBlank()) {
      return ShareLinkFailure(ShareLinkFailureCode.INVALID_URL, "链接缺少 host")
    }
    if (uri.userInfo != null) {
      return ShareLinkFailure(ShareLinkFailureCode.INVALID_URL, "拒绝携带 userinfo 的链接")
    }
    if (uri.port != -1 && uri.port != 443) {
      return ShareLinkFailure(ShareLinkFailureCode.INVALID_URL, "拒绝非默认端口")
    }
    if (host.lowercase() !in ALLOWED_HOSTS) {
      return ShareLinkFailure(ShareLinkFailureCode.UNSUPPORTED_HOST, "不是网易云官方分享域名")
    }
    return null
  }
}

/** identity 解析结果：Parsed = 成功；其余为可诊断的失败或「未识别需继续 redirect」。 */
sealed interface IdentityOutcome {
  data class Parsed(val resource: NetEaseSharedResource) : IdentityOutcome
  data class UnsupportedType(val type: String) : IdentityOutcome
  data class InvalidId(val detail: String) : IdentityOutcome
  data object NotRecognized : IdentityOutcome
}

/** 从 URL path/query 解析资源类型与 numeric ID；只识别已知 canonical 形态。 */
internal object NetEaseShareIdentity {
  private const val MAX_JS_SAFE_INTEGER = 9_007_199_254_740_991L
  private val SUPPORTED = setOf("song", "playlist")
  private val UNSUPPORTED = setOf(
    "album",
    "artist",
    "mv",
    "user",
    "program",
    "djradio",
    "radio",
    "video",
    "topic",
    "event",
  )

  fun parse(uri: URI): IdentityOutcome {
    val type = resourceType(uri.path) ?: return IdentityOutcome.NotRecognized
    if (type in UNSUPPORTED) return IdentityOutcome.UnsupportedType(type)
    if (type !in SUPPORTED) return IdentityOutcome.NotRecognized

    val idRaw = queryId(uri)
    if (idRaw == null) {
      return IdentityOutcome.InvalidId("链接缺少资源 id")
    }
    val id = parsePositiveSafeId(idRaw)
      ?: return IdentityOutcome.InvalidId("资源 id 必须是正安全整数")

    return IdentityOutcome.Parsed(
      when (type) {
        "song" -> NetEaseSharedResource.Song(id)
        else -> NetEaseSharedResource.Playlist(id)
      },
    )
  }

  /** supported identity 只接受冻结的 canonical path；unsupported type 保留既有诊断语义。 */
  private fun resourceType(path: String?): String? {
    if (path.isNullOrBlank()) return null
    when (path) {
      "/song", "/song/" -> return "song"
      "/playlist", "/playlist/" -> return "playlist"
      "/m/song", "/m/song/" -> return "song"
      "/m/playlist", "/m/playlist/" -> return "playlist"
    }

    val segments = path.trim('/').split('/').filter { it.isNotBlank() }
    if (segments.isEmpty()) return null
    val candidate = if (segments.size >= 2 && segments[0] == "m") segments[1] else segments[0]
    return candidate.lowercase().takeIf { it in UNSUPPORTED }
  }

  private fun queryId(uri: URI): String? {
    val query = uri.rawQuery ?: return null
    for (pair in query.split('&')) {
      val index = pair.indexOf('=')
      val key = if (index < 0) pair else pair.substring(0, index)
      if (key == "id") {
        return if (index < 0) null else pair.substring(index + 1)
      }
    }
    return null
  }

  private fun parsePositiveSafeId(raw: String): Long? {
    if (raw.isEmpty() || !raw.all { it.isDigit() }) return null
    val value = raw.toLongOrNull() ?: return null
    if (value <= 0 || value > MAX_JS_SAFE_INTEGER) return null
    return value
  }
}
