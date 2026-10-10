package expo.modules.webtools

import org.jsoup.Jsoup
import org.jsoup.parser.Parser
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.HttpUrl.Companion.toHttpUrl
import java.io.ByteArrayInputStream
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

object WebContentParser {
  fun search(xml: String, query: String, limit: Int): Map<String, Any> {
    val document = Jsoup.parse(xml, "", Parser.xmlParser())
    val channel = document.selectFirst("rss > channel")
      ?: throw WebFailure("WEB_SEARCH_UNAVAILABLE", "搜索来源未返回有效结果，可能受到限流或验证限制")
    val items = channel.select("item").map { item ->
      val title = item.selectFirst("title")?.text().orEmpty()
      val link = item.selectFirst("link")?.text().orEmpty()
      if (title.isBlank() || link.isBlank()) throw WebFailure("WEB_INVALID_RESPONSE", "搜索结果缺少标题或来源链接")
      // 搜索链接只是来源元数据；是否允许实际访问由联网边界负责。
      val url = link.toHttpUrlOrNull()?.toString()
        ?: throw WebFailure("WEB_INVALID_RESPONSE", "搜索来源链接无效")
      mapOf("title" to title.take(300), "url" to url,
        "snippet" to Jsoup.parse(item.selectFirst("description")?.text().orEmpty()).text().take(1000))
    }.distinctBy { it.getValue("url") }.take(limit)
    return mapOf("query" to query, "source" to "Bing RSS", "items" to items)
  }

  fun page(bytes: ByteArray, charset: String?, url: String, contentType: String, maxChars: Int): Map<String, Any> {
    val html = contentType == "text/html" || contentType == "application/xhtml+xml"
    if (!html && !contentType.startsWith("text/") && contentType !in setOf("application/json", "application/xml")) {
      throw WebFailure("WEB_UNSUPPORTED_CONTENT", "该链接不是网页或文本，请使用 download_file 保存文件")
    }
    val title: String
    val text: String
    val links: List<Map<String, String>>
    if (html) {
      val document = Jsoup.parse(ByteArrayInputStream(bytes), charset, url)
      title = document.title().take(300)
      document.select("script, style, nav, header, footer, form, noscript, svg, template, iframe, aside, [hidden], [aria-hidden=true]").remove()
      val content = document.selectFirst("article") ?: document.selectFirst("main") ?: document.body()
      text = content.wholeText().lines().map(String::trim).filter(String::isNotBlank).joinToString("\n")
      links = content.select("a[href]").mapNotNull { element ->
        val target = element.absUrl("href")
        if (!target.startsWith("https://")) null
        else mapOf("title" to element.text().take(160), "url" to target)
      }.distinctBy { it.getValue("url") }.take(20)
    } else {
      title = ""
      text = String(bytes, charset?.let { java.nio.charset.Charset.forName(it) } ?: StandardCharsets.UTF_8)
      links = emptyList()
    }
    if (text.isBlank()) throw WebFailure("WEB_EMPTY_CONTENT", "网页没有可读取正文，可能需要登录或执行脚本")
    return mapOf("url" to url, "title" to title, "contentType" to contentType,
      "text" to text.take(maxChars), "truncated" to (text.length > maxChars), "links" to links)
  }

  fun fileName(requested: String?, disposition: String?, url: String, suffix: String): String {
    val candidate = requested ?: disposition?.let { header ->
      val encoded = Regex("filename\\*\\s*=\\s*UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)
      if (encoded != null) decode(encoded) else {
        Regex("filename\\s*=\\s*(?:\"([^\"]+)\"|([^;]+))", RegexOption.IGNORE_CASE).find(header)?.let { match ->
          match.groupValues[1].ifEmpty { match.groupValues[2] }.trim()
        }
      }
    } ?: url.toHttpUrl().pathSegments.last()
    val safe = candidate.replace(Regex("[\\p{Cntrl}/\\\\:*?\"<>|]"), "_").trim().trim('.').ifBlank { "download" }
    val dot = safe.lastIndexOf('.').takeIf { it > 0 && safe.length - it <= 16 }
    val base = if (dot != null) safe.substring(0, dot) else safe
    val extension = if (dot != null) safe.substring(dot) else ""
    return "${truncateName(base, 160)}-$suffix${truncateName(extension, 32)}"
  }

  private fun truncateName(value: String, maxBytes: Int): String {
    val result = StringBuilder()
    var bytes = 0
    for (point in value.codePoints().toArray()) {
      val character = String(Character.toChars(point))
      bytes += character.toByteArray(StandardCharsets.UTF_8).size
      if (bytes > maxBytes) break
      result.append(character)
    }
    return result.toString()
  }

  private fun decode(value: String): String = try {
    // URLDecoder 的表单 '+' 规则不适用于路径或 RFC 5987 文件名。
    URLDecoder.decode(value.replace("+", "%2B"), "UTF-8")
  } catch (_: IllegalArgumentException) {
    throw WebFailure("WEB_INVALID_RESPONSE", "文件名含有无效的 URL 编码")
  }
}
