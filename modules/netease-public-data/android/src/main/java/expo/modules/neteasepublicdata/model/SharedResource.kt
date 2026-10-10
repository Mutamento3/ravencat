package expo.modules.neteasepublicdata.model

/**
 * Share-link resolver 的独立失败语义，与 EAPI 的 [PublicDataFailureCode] 分离：
 * HTTP redirect resolving 与 EAPI 是两个不同 protocol path。
 */
enum class ShareLinkFailureCode(val wireValue: String) {
  INVALID_URL("invalid_url"),
  UNSUPPORTED_HOST("unsupported_host"),
  REDIRECT_REJECTED("redirect_rejected"),
  TOO_MANY_REDIRECTS("too_many_redirects"),
  NETWORK_FAILURE("network_failure"),
  UNSUPPORTED_RESOURCE_TYPE("unsupported_resource_type"),
  INVALID_RESOURCE_ID("invalid_resource_id"),
  UNRESOLVABLE_SHARE_LINK("unresolvable_share_link"),
}

data class ShareLinkFailure(
  val code: ShareLinkFailureCode,
  val message: String,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "code" to code.wireValue,
    "message" to message.take(300),
  )
}

sealed class ShareLinkResult<out T> {
  data class Success<T>(val data: T) : ShareLinkResult<T>()
  data class Failure(val error: ShareLinkFailure) : ShareLinkResult<Nothing>()

  fun toBridgeMap(mapData: (T) -> Any?): Map<String, Any?> = when (this) {
    is Success -> mapOf("ok" to true, "data" to mapData(data))
    is Failure -> mapOf("ok" to false, "error" to error.toMap())
  }
}

/**
 * Share-link resolver 唯一承诺输出的 identity：只包含稳定 numeric ID。
 *
 * 不输出 title / 歌手 / 封面等 metadata；metadata 属于搜索 / 未来 detail capability。
 */
sealed class NetEaseSharedResource {
  data class Song(val songId: Long) : NetEaseSharedResource()
  data class Playlist(val playlistId: Long) : NetEaseSharedResource()

  fun toMap(): Map<String, Any> = when (this) {
    is Song -> mapOf("type" to "song", "songId" to songId.toDouble())
    is Playlist -> mapOf("type" to "playlist", "playlistId" to playlistId.toDouble())
  }
}
