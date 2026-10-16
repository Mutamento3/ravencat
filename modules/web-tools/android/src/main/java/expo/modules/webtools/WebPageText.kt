package expo.modules.webtools

import org.jsoup.nodes.Element
import org.jsoup.nodes.Node
import org.jsoup.nodes.TextNode
import java.security.MessageDigest

/** 轻量保留正文结构；续读以正文指纹为契约，不把变化后的页面接到旧偏移上。 */
object WebPageText {
  fun render(root: Element): String {
    val output = StringBuilder()
    // 网页嵌套深度由外部站点决定，遍历不占用与深度成正比的调用栈。
    val pending = ArrayDeque<Pair<Node, Boolean>>()
    pending.add(root to false)
    while (pending.isNotEmpty()) {
      val (node, closing) = pending.removeLast()
      if (node is TextNode) { output.append(node.wholeText.replace(Regex("\\s+"), " ")); continue }
      if (node !is Element) continue
      val tag = node.normalName()
      val block = tag in setOf("p", "div", "section", "article", "main", "blockquote", "ul", "ol", "dl")
      val heading = tag.matches(Regex("h[1-6]"))
      val href = if (tag == "a") node.absUrl("href").takeIf { it.startsWith("https://") } else null
      if (closing) {
        if (href != null) output.append("]($href)")
        if (block || heading) output.append("\n\n")
        continue
      }
      if (tag == "pre") { output.append("\n\n```\n${node.wholeText()}\n```\n\n"); continue }
      if (tag == "table") {
        output.append("\n\n")
        node.select("tr").forEach { row ->
          output.append(row.children().filter { it.normalName() in setOf("td", "th") }.joinToString(" | ", "| ", " |\n") { it.text() })
        }
        output.append("\n"); continue
      }
      if (block) output.append("\n\n")
      if (heading) output.append("\n\n${"#".repeat(tag.last().digitToInt())} ")
      if (tag == "li") output.append("\n- ")
      if (tag == "br") output.append("\n")
      if (href != null) output.append("[")
      pending.add(node to true)
      node.childNodes().asReversed().forEach { pending.add(it to false) }
    }
    return output.toString().lines().joinToString("\n") { it.trimEnd() }.replace(Regex("\n{3,}"), "\n\n").trim()
  }

  fun window(text: String, maxChars: Int, startChar: Int, find: String?, expectedVersion: String?): Map<String, Any?> {
    val version = MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    if (expectedVersion != null && expectedVersion != version) throw WebFailure("WEB_PAGE_CHANGED", "网页正文已变化，请从头重新读取并使用新的 document_version")
    if (startChar > text.length) throw WebFailure("WEB_OFFSET_OUT_OF_RANGE", "读取位置超过正文长度 ${text.length}，请检查 start_char 或重新读取")
    val positions = mutableListOf<Int>()
    if (find != null) {
      var position = text.indexOf(find, startChar, ignoreCase = true)
      while (position >= 0 && positions.size < 10) {
        positions.add(position)
        position = text.indexOf(find, position + find.length, ignoreCase = true)
      }
    }
    val start = if (find != null && positions.isNotEmpty()) maxOf(startChar, positions.first() - 200) else startChar
    val end = if (find != null && positions.isEmpty()) start else minOf(text.length, start + maxChars)
    return mapOf("text" to text.substring(start, end), "startChar" to start,
      "nextStartChar" to if (end < text.length && (find == null || positions.isNotEmpty())) end else null,
      "totalChars" to text.length, "truncated" to (end < text.length), "documentVersion" to version,
      "matches" to positions.map { position -> mapOf("startChar" to position, "text" to text.substring(maxOf(0, position - 80), minOf(text.length, position + find!!.length + 160))) })
  }
}
