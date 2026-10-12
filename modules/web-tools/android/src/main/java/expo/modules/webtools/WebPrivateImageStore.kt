package expo.modules.webtools

import okhttp3.Response
import java.io.File
import java.util.UUID

/** 只在应用缓存中准备图片；JS 媒体 owner 提交持久引用后负责删除暂存文件。 */
class WebPrivateImageStore(private val cacheDirectory: File) {
  fun save(response: Response, requestedName: String?, request: WebRequest): Map<String, Any> {
    val body = response.body ?: throw WebFailure("WEB_INVALID_RESPONSE", "网站未返回图片")
    val maxBytes = 50L * 1024 * 1024
    if (body.contentLength() > maxBytes) throw WebFailure("WEB_TOO_LARGE", "图片不能超过 50 MiB")
    val directory = File(cacheDirectory, "ravencat-image-downloads")
    if (!directory.exists() && !directory.mkdirs()) throw WebFailure("WEB_DOWNLOAD_FAILED", "无法创建图片暂存目录")
    val file = File(directory, UUID.randomUUID().toString())
    try {
      request.checkActive()
      val size = file.outputStream().use { output ->
        body.byteStream().use { input -> copyWebBody(input, output, maxBytes, request) }
      }
      val url = response.request.url.toString()
      val name = WebContentParser.fileName(requestedName, response.header("Content-Disposition"), url, UUID.randomUUID().toString())
      return request.publish {
        mapOf("url" to url, "uri" to file.toURI().toString(), "fileName" to name,
          "directory" to "应用私有媒体库", "mimeType" to (body.contentType()?.toString() ?: "application/octet-stream"), "sizeBytes" to size)
      }
    } catch (error: Exception) {
      file.delete()
      throw error
    }
  }
}
