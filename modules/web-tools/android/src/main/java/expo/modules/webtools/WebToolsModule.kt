package expo.modules.webtools

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Dns

/** 只有此边界把外部网络失败转换为可读结果；内部契约异常直接暴露。 */
class WebToolsModule : Module() {
  private val client = WebHttpClient(vpnRoute = ::currentVpnRoute)
  private val requests = ConcurrentHashMap<String, WebRequest>()

  override fun definition() = ModuleDefinition {
    Name("RavenCatWebTools")

    Function("createRequest") { connectionMode: String ->
      UUID.randomUUID().toString().also { requests[it] = WebRequest(connectionMode) }
    }
    Function("cancelRequest") { id: String -> requests[id]?.cancel() }

    AsyncFunction("search") Coroutine { id: String, query: String, limit: Int, engine: String, apiKey: String?, depth: String, timeRange: String?, includeImages: Boolean ->
      perform(id) { request ->
        WebSearchClient(client).search(engine, query, limit, apiKey, depth, timeRange, includeImages, request)
      }
    }
    AsyncFunction("readPage") Coroutine { id: String, url: String, maxChars: Int, startChar: Int, find: String?, documentVersion: String? ->
      perform(id) { request ->
        client.get(url, request) { response ->
          val bytes = readWebBody(response, 2L * 1024 * 1024, request)
          val type = response.body!!.contentType()
          WebContentParser.page(bytes, type?.charset(null)?.name(), response.request.url.toString(),
            type?.let { "${it.type}/${it.subtype}" }.orEmpty(), maxChars, startChar, find, documentVersion)
        }
      }
    }
    AsyncFunction("download") Coroutine { id: String, url: String, fileName: String? ->
      perform(id) { request ->
        val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
        client.get(url, request, download = true) { response ->
          WebDownloadStore(context.contentResolver).save(response, fileName, request)
        }
      }
    }
    AsyncFunction("downloadImage") Coroutine { id: String, url: String, fileName: String? ->
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

  // Expo 默认异步队列由所有模块共享；阻塞网络和文件 IO 不能占用它，否则会阻塞配置页读取密钥等操作。
  private suspend fun perform(id: String, execute: (WebRequest) -> Map<String, Any?>): Map<String, Any> = withContext(Dispatchers.IO) {
    val request = requests.getValue(id)
    try {
      request.checkActive()
      mapOf("ok" to true, "data" to execute(request))
    } catch (error: WebFailure) {
      failure(error.code, error.message!!)
    } finally {
      requests.remove(id)
    }
  }

  private fun failure(code: String, message: String): Map<String, Any> =
    mapOf("ok" to false, "error" to mapOf("code" to code, "message" to message))

  /** activeNetwork 属于调用应用；不能因手机上存在别的 VPN，就放宽本应用的 DNS 边界。 */
  private fun currentVpnRoute(): WebVpnRoute? {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val network = connectivity.activeNetwork ?: return null
    val capabilities = connectivity.getNetworkCapabilities(network) ?: return null
    if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) return null
    return WebVpnRoute(object : Dns {
      override fun lookup(hostname: String) = network.getAllByName(hostname).toList()
    }, network.socketFactory)
  }
}
