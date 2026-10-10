package expo.modules.webtools

import android.content.ContentResolver
import android.content.ContentValues
import android.os.Environment
import android.provider.MediaStore
import okhttp3.Response
import java.util.UUID

/** 下载产物属于用户公共下载目录；与备份产物、应用内部媒体资产没有所有权交叉。 */
class WebDownloadStore(private val resolver: ContentResolver) {
  fun save(response: Response, requestedName: String?, request: WebRequest): Map<String, Any> {
    val body = response.body ?: throw WebFailure("WEB_INVALID_RESPONSE", "网站未返回文件")
    val maxBytes = 50L * 1024 * 1024
    if (body.contentLength() > maxBytes) throw WebFailure("WEB_TOO_LARGE", "下载文件不能超过 50 MiB")
    val url = response.request.url.toString()
    val name = WebContentParser.fileName(requestedName, response.header("Content-Disposition"), url, UUID.randomUUID().toString())
    val mimeType = body.contentType()?.let { "${it.type}/${it.subtype}" } ?: "application/octet-stream"
    val directory = "${Environment.DIRECTORY_DOWNLOADS}/RavenCat AI/"
    request.checkActive()
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, mimeType)
      put(MediaStore.Downloads.RELATIVE_PATH, directory)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }) ?: throw WebFailure("WEB_DOWNLOAD_FAILED", "无法在下载目录创建文件")
    try {
      val size = resolver.openOutputStream(uri, "w")?.use { output ->
        body.byteStream().use { input -> copyWebBody(input, output, maxBytes, request) }
      } ?: throw WebFailure("WEB_DOWNLOAD_FAILED", "无法写入下载文件")
      // MediaStore 负责最终显示名；查询真实名称，不能向模型声称保存了预期名称。
      val actualName = resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (!cursor.moveToFirst()) throw WebFailure("WEB_DOWNLOAD_FAILED", "无法读取已保存文件信息")
        cursor.getString(0)
      } ?: throw WebFailure("WEB_DOWNLOAD_FAILED", "无法读取已保存文件信息")
      val result = mapOf("url" to url, "uri" to uri.toString(), "fileName" to actualName,
        "directory" to directory, "mimeType" to mimeType, "sizeBytes" to size)
      return request.publish {
        val updated = resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        if (updated != 1) throw WebFailure("WEB_DOWNLOAD_FAILED", "无法完成下载文件发布")
        result
      }
    } catch (error: Exception) {
      resolver.delete(uri, null, null)
      throw error
    }
  }
}
