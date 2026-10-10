package expo.modules.deviceobserver

import android.content.Context
import java.io.File

/**
 * RavenCat 自己管理的设备观察截图文件。
 *
 * 删除与 OCR 共用同一份路径校验，避免原生入口退化成任意本地文件读取器：
 * 只接受 App 私有缓存目录内的直接文件，不接受 content://、相册或下载目录。
 */
internal object ManagedScreenshotFile {
  private const val DIRECTORY_NAME = "device-observer"
  private const val FILE_URI_PREFIX = "file://"

  fun directory(context: Context): File = File(context.cacheDir, DIRECTORY_NAME)

  fun resolve(rootDirectory: File, uri: String): File? {
    if (!uri.startsWith(FILE_URI_PREFIX)) return null
    val rawPath = uri.removePrefix(FILE_URI_PREFIX)
    if (rawPath.isBlank()) return null
    return runCatching {
      val target = File(rawPath).canonicalFile
      if (target.parentFile != rootDirectory.canonicalFile) null else target
    }.getOrNull()
  }
}
