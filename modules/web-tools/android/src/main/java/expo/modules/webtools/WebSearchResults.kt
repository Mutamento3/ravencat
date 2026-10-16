package expo.modules.webtools

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONObject
import org.json.JSONException
import org.jsoup.Jsoup

/** 外部搜索响应在此转为统一结果；URL 去重只执行一次，不将转载当作独立证据。 */
object WebSearchResults {
  fun finish(engine: String, source: String, query: String, items: List<Map<String, Any>>, limit: Int): Map<String, Any> {
    val unique = linkedMapOf<String, MutableMap<String, Any>>()
    for (item in items) {
      val rawUrl = item.getValue("url") as String
      val url = rawUrl.toHttpUrlOrNull() ?: throw WebFailure("WEB_INVALID_RESPONSE", "搜索来源链接无效")
      val key = url.newBuilder().fragment(null).apply {
        // 只删除明确的跟踪参数，保留业务参数、路径大小写与尾斜杠。
        url.queryParameterNames.filter { it.startsWith("utm_", true) || it.lowercase() in setOf("gclid", "fbclid", "msclkid") }
          .forEach { removeAllQueryParameters(it) }
      }.build().toString()
      val previous = unique[key]
      if (previous == null) unique[key] = item.toMutableMap().also { it["url"] = url.toString() }
      else {
        val snippets = listOf(previous.getValue("snippet") as String, item.getValue("snippet") as String).filter(String::isNotBlank).distinct()
        previous["snippet"] = snippets.joinToString("\n").take(4000)
      }
    }
    return mapOf("query" to query, "engine" to engine, "source" to source,
      "items" to unique.values.take(limit), "duplicatesRemoved" to (items.size - unique.size))
  }

  fun duckDuckGo(html: String, query: String, limit: Int): Map<String, Any> {
    val document = Jsoup.parse(html, "https://html.duckduckgo.com/")
    if (document.select("form[action*=anomaly], #challenge-form, .anomaly-modal").isNotEmpty()) {
      throw WebFailure("WEB_SEARCH_UNAVAILABLE", "DuckDuckGo 要求验证码，请选择其他已启用来源")
    }
    val results = document.select(".result").filter { it.selectFirst(".result__a") != null }
    if (results.isEmpty() && document.select(".no-results, .no-results__message").isEmpty()) {
      throw WebFailure("WEB_SEARCH_UNAVAILABLE", "DuckDuckGo 未返回可识别的搜索结果，可能受到验证或页面变化影响")
    }
    val items = results.filter { it.selectFirst(".result__badge--ad, .result__ad") == null && !it.hasClass("result--ad") }.map { result ->
      val link = result.selectFirst(".result__a")!!
      val wrapper = link.absUrl("href").toHttpUrlOrNull()
        ?: throw WebFailure("WEB_INVALID_RESPONSE", "DuckDuckGo 来源链接无效")
      val target = if (wrapper.host == "duckduckgo.com" || wrapper.host.endsWith(".duckduckgo.com")) wrapper.queryParameter("uddg") ?: wrapper.toString() else wrapper.toString()
      item(link.text(), target, result.selectFirst(".result__snippet")?.text().orEmpty())
    }
    return finish("duckduckgo", "DuckDuckGo", query, items, limit)
  }

  fun tavily(json: String, query: String, limit: Int): Map<String, Any> = parseJson {
    val results = JSONObject(json).getJSONArray("results")
    val items = (0 until results.length()).map { index ->
      val row = results.getJSONObject(index)
      item(row.getString("title"), row.getString("url"), row.getString("content")).toMutableMap().apply {
        if (row.has("score") && !row.isNull("score")) put("score", row.getDouble("score"))
        if (row.has("published_date") && !row.isNull("published_date")) put("publishedAt", row.getString("published_date").take(100))
      }
    }
    finish("tavily", "Tavily", query, items, limit)
  }

  fun brave(json: String, query: String, limit: Int): Map<String, Any> = parseJson {
    val root = JSONObject(json)
    // Brave 的正常响应允许没有 web 分类（如只有其他垂直结果）；错误对象不能伪装成空结果。
    if (root.has("error")) throw WebFailure("WEB_INVALID_RESPONSE", "Brave 未返回有效的搜索响应")
    root.getJSONObject("query")
    val results = if (root.has("web")) root.getJSONObject("web").getJSONArray("results") else null
    val items = if (results == null) emptyList() else (0 until results.length()).map { index ->
      val row = results.getJSONObject(index)
      val snippets = mutableListOf(row.optString("description", ""))
      if (row.has("extra_snippets")) {
        val extra = row.getJSONArray("extra_snippets")
        for (i in 0 until extra.length()) snippets.add(extra.getString(i))
      }
      item(row.getString("title"), row.getString("url"), snippets.distinct().joinToString("\n"))
    }
    finish("brave", "Brave Search", query, items, limit)
  }

  private fun item(title: String, url: String, snippet: String): Map<String, Any> {
    val cleanTitle = Jsoup.parse(title).text().take(300)
    if (cleanTitle.isBlank() || url.isBlank()) throw WebFailure("WEB_INVALID_RESPONSE", "搜索结果缺少标题或来源链接")
    return mapOf("title" to cleanTitle, "url" to url,
      "snippet" to Jsoup.parse(snippet.replace("\n", "<br>")).wholeText().trim().take(4000))
  }

  private fun parseJson(action: () -> Map<String, Any>): Map<String, Any> = try { action() }
  catch (_: JSONException) { throw WebFailure("WEB_INVALID_RESPONSE", "搜索服务返回的数据格式无效") }
}
