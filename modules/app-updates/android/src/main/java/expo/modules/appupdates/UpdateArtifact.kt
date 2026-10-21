package expo.modules.appupdates

import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipFile

/** 只提取约定的根目录 APK 到固定缓存文件，不把压缩包内路径映射到文件系统。 */
internal fun extractUpdateArtifact(archive: File, output: File, entryName: String, size: Long) {
  try {
    ZipFile(archive).use { zip ->
      val entry = requireNotNull(zip.getEntry(entryName)) { "压缩包缺少当前版本的安装包" }
      zip.getInputStream(entry).buffered().use { input ->
        output.outputStream().buffered().use { target ->
          val buffer = ByteArray(64 * 1024)
          var written = 0L
          while (true) {
            val count = input.read(buffer)
            if (count == -1) break
            written += count
            // 解压会放大外部文件；按可信发布大小限制实际输出，避免恶意压缩包耗尽缓存。
            require(written <= size) { "压缩包内安装包超出发布大小" }
            target.write(buffer, 0, count)
          }
        }
      }
    }
  } catch (error: Exception) {
    output.delete()
    throw error
  }
}

/** APK 是文件边界输入；流式校验避免把约 200 MB 的安装包读进 JS 或一次性读入内存。 */
internal fun verifyUpdateArtifact(file: File, sha256: String, size: Long) {
  require(file.length() == size) { "安装包大小与 GitHub 发布信息不一致，请重新下载" }
  val digest = MessageDigest.getInstance("SHA-256")
  file.inputStream().buffered().use { input ->
    val buffer = ByteArray(64 * 1024)
    while (true) {
      val count = input.read(buffer)
      if (count == -1) break
      digest.update(buffer, 0, count)
    }
  }
  val actual = digest.digest().joinToString("") { "%02x".format(it) }
  require(actual == sha256) { "安装包 SHA-256 校验失败，请重新下载" }
}
