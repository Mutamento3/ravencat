package expo.modules.webtools

import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Response
import org.json.JSONObject

/** 每次只访问调用方选择的来源；网络失败不在这里切换引擎或重试。 */
class WebSearchClient(private val client: WebHttpClient) {
  fun search(engine: String, query: String, limit: Int, apiKey: String?, depth: String, timeRange: String?, includeImages: Boolean, request: WebRequest): Map<String, Any> {
    return when (engine) {
      "bing" -> {
        val url = "https://www.bing.com/search".toHttpUrl().newBuilder()
          .addQueryParameter("format", "rss").addQueryParameter("q", query).build()
        client.get(url.toString(), request) { response -> WebContentParser.search(body(response, request), query, limit) }
      }
      "duckduckgo" -> {
        val url = "https://html.duckduckgo.com/html/".toHttpUrl().newBuilder().addQueryParameter("q", query)
        if (timeRange != null) url.addQueryParameter("df", when (timeRange) { "day" -> "d"; "week" -> "w"; "month" -> "m"; "year" -> "y"; else -> error("未知时间范围") })
        client.get(url.build().toString(), request) { response -> WebSearchResults.duckDuckGo(body(response, request), query, limit) }
      }
      "tavily" -> {
        val json = JSONObject().put("query", query).put("max_results", limit).put("search_depth", depth)
          .put("include_answer", false).put("include_raw_content", false).put("auto_parameters", false)
          .put("include_images", includeImages).put("include_image_descriptions", includeImages)
        if (timeRange != null) json.put("time_range", timeRange)
        client.searchApi("https://api.tavily.com/search", request, mapOf("Authorization" to "Bearer ${apiKey!!}"), json.toString()) { response ->
          WebSearchResults.tavily(body(response, request), query, limit, includeImages)
        }
      }
      "brave" -> {
        val url = "https://api.search.brave.com/res/v1/web/search".toHttpUrl().newBuilder()
          .addQueryParameter("q", query).addQueryParameter("count", limit.toString()).addQueryParameter("extra_snippets", "true")
        if (timeRange != null) url.addQueryParameter("freshness", when (timeRange) { "day" -> "pd"; "week" -> "pw"; "month" -> "pm"; "year" -> "py"; else -> error("未知时间范围") })
        client.searchApi(url.build().toString(), request, mapOf("X-Subscription-Token" to apiKey!!, "Accept" to "application/json")) { response ->
          WebSearchResults.brave(body(response, request), query, limit)
        }
      }
      else -> error("未知搜索来源：$engine")
    }
  }

  private fun body(response: Response, request: WebRequest): String {
    val bytes = readWebBody(response, 1024L * 1024, request)
    return String(bytes, response.body!!.contentType()?.charset(Charsets.UTF_8) ?: Charsets.UTF_8)
  }
}
