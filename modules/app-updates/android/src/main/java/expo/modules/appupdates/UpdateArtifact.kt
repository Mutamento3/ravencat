package expo.modules.appupdates

import java.io.File
import java.security.MessageDigest

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
