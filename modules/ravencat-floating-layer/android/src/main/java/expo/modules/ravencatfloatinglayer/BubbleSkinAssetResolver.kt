package expo.modules.ravencatfloatinglayer

import android.content.Context
import android.net.Uri
import java.io.File
import java.net.URLDecoder
import java.nio.file.Files
import java.nio.file.LinkOption

/**
 * native-bubble-skin backing 的只读 resolver。
 *
 * MediaAsset 只保存 backing-relative 的文件名；原生层拥有真实目录根和
 * `file://` URI 的生成方式。解析边界不接受 URI、绝对路径或目录路径，避免
 * 把设备路径重新变成跨设备资产身份，也避免把 key 当作任意文件路径使用。
 */
internal object BubbleSkinAssetResolver {
  const val STORAGE_DIRECTORY = "ravencat/bubble-skins"

  /** 将装扮目录下的稳定文件名解析为当前设备可读的 file:// URI。 */
  fun resolve(context: Context, storageKey: String): String? {
    val filesRoot = context.filesDir.canonicalFile
    val expectedRoot = File(filesRoot, STORAGE_DIRECTORY)
    val root = expectedRoot.canonicalFile

    // backing 根本身也必须是应用 files 根下的真实目录，不能通过目录软链接逃逸。
    require(root.path == expectedRoot.path) {
      "native-bubble-skin backing 根目录非法"
    }

    val file = resolveFile(root, storageKey) ?: return null
    return Uri.fromFile(file).toString()
  }

  /**
   * 供原生单元测试复用的纯文件解析边界；rootDirectory 仍必须是已建立的 backing 根。
   */
  internal fun resolveFile(rootDirectory: File, storageKey: String): File? {
    val root = rootDirectory.canonicalFile
    require(Files.isDirectory(root.toPath(), LinkOption.NOFOLLOW_LINKS)) {
      "native-bubble-skin backing 根目录不存在"
    }

    val key = validateStorageKey(storageKey)
    val candidate = File(root, key)

    // 软链接即使最终指向根内文件，也不是 backing 自己拥有的普通文件。
    if (Files.isSymbolicLink(candidate.toPath())) return null

    val file = candidate.canonicalFile
    require(file.parentFile == root) {
      "native-bubble-skin storageKey 必须位于 backing 根目录"
    }
    if (!Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return null
    return file
  }

  private fun validateStorageKey(storageKey: String): String {
    require(storageKey.isNotEmpty()) {
      "native-bubble-skin storageKey 不能为空"
    }
    require(storageKey.none(Char::isISOControl)) {
      "native-bubble-skin storageKey 含有控制字符"
    }
    require(!STORAGE_URI_SCHEME.matches(storageKey)) {
      "native-bubble-skin storageKey 不得是 URI 或绝对路径"
    }
    require(!storageKey.contains('/') && !storageKey.contains('\\')) {
      "native-bubble-skin storageKey 只能是装扮目录下的文件名"
    }

    // 百分号编码不是本 backing 的文件名编码；拒绝解码后会产生路径语义的 key，
    // 防止调用方绕过分隔符和 .. 检查。
    val decoded = URLDecoder.decode(storageKey, Charsets.UTF_8.name())
    require(decoded.none(Char::isISOControl)) {
      "native-bubble-skin storageKey 含有编码控制字符"
    }
    require(!decoded.contains('/') && !decoded.contains('\\')) {
      "native-bubble-skin storageKey 不得包含编码路径分隔符"
    }
    require(decoded != "." && decoded != "..") {
      "native-bubble-skin storageKey 不得是路径遍历片段"
    }

    return storageKey
  }

  private val STORAGE_URI_SCHEME = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")
}
