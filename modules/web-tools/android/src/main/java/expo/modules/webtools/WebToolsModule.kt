package expo.modules.webtools

import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** 只有此边界把外部网络失败转换为可读结果；内部契约异常直接暴露。 */
class WebToolsModule : Module() {
  private val client = WebHttpClient()
  private val requests = ConcurrentHashMap<String, WebRequest>()

  override fun definition() = ModuleDefinition {
    Name("RavenCatWebTools")

    Function("createRequest") {
      UUID.randomUUID().toString().also { requests[it] = WebRequest() }
    }
    Function("cancelRequest") { id: String -> requests[id]?.cancel() }

    AsyncFunction("search") { id: String, query: String, limit: Int, engine: String, apiKey: String?, depth: String, timeRange: String? ->
      perform(id) { request ->
        WebSearchClient(client).search(engine, query, limit, apiKey, depth, timeRange, request)
      }
    }
    AsyncFunction("readPage") { id: String, url: String, maxChars: Int, startChar: Int, find: String?, documentVersion: String? ->
      perform(id) { request ->
        client.get(url, request) { response ->
          val bytes = readWebBody(response, 2L * 1024 * 1024, request)
          val type = response.body!!.contentType()
          WebContentParser.page(bytes, type?.charset(null)?.name(), response.request.url.toString(),
            type?.let { "${it.type}/${it.subtype}" }.orEmpty(), maxChars, startChar, find, documentVersion)
        }
      }
    }
    AsyncFunction("download") { id: String, url: String, fileName: String? ->
      perform(id) { request ->
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        client.get(url, request, download = true) { response ->
          WebDownloadStore(context.contentResolver).save(response, fileName, request)
        }
      }
    }
    AsyncFunction("downloadImage") { id: String, url: String, fileName: String? ->
      perform(id) { request ->
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        client.get(url, request, download = true) { response ->
          WebPrivateImageStore(context.cacheDir).save(response, fileName, request)
        }
      }
    }
    OnDestroy {
      requests.values.forEach(WebRequest::cancel)
      requests.clear()
    }
  }

  private fun perform(id: String, execute: (WebRequest) -> Map<String, Any?>): Map<String, Any> {
    val request = requests.getValue(id)
    try {
      request.checkActive()
      return mapOf("ok" to true, "data" to execute(request))
    } catch (error: WebFailure) {
      return failure(error.code, error.message!!)
    } catch (_: IOException) {
      request.checkActive()
      return failure("WEB_NETWORK_FAILED", "网络连接失败或超时，请向用户说明当前无法获取该内容")
    } finally {
      requests.remove(id)
    }
  }

  private fun failure(code: String, message: String): Map<String, Any> =
    mapOf("ok" to false, "error" to mapOf("code" to code, "message" to message))
}
