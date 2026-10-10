package expo.modules.neteasepublicdata.protocol

import expo.modules.neteasepublicdata.model.PublicDataFailure
import expo.modules.neteasepublicdata.model.PublicDataFailureCode
import expo.modules.neteasepublicdata.model.PublicDataResult
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.SecureRandom
import org.json.JSONObject

data class EapiResponse(val httpStatus: Int, val body: JSONObject)

fun interface EapiTransport {
  fun request(uri: String, data: JSONObject): PublicDataResult<EapiResponse>
}

class HttpsEapiTransport : EapiTransport {
  companion object {
    private const val ORIGIN = "https://interfacepc.music.163.com"
    private const val APP_VERSION = "9.5.61.260802021928"
    private const val TIMEOUT_MS = 15_000
    private const val MAX_RESPONSE_CHARACTERS = 8 * 1024 * 1024
  }

  private val random = SecureRandom()
  private val deviceId = ByteArray(16).also(random::nextBytes)
    .joinToString("") { byte -> "%02X".format(byte.toInt() and 0xff) }

  override fun request(uri: String, data: JSONObject): PublicDataResult<EapiResponse> {
    val header = createHeader()
    val payload = JSONObject(data.toString()).put("e_r", false).put("header", header)
    val params = EapiCodec.encrypt(uri, payload.toString())
    val endpoint = "$ORIGIN/eapi/${uri.removePrefix("/api/")}"
    val connection = try {
      URI(endpoint).toURL().openConnection() as HttpURLConnection
    } catch (error: IOException) {
      return networkFailure(error)
    }

    return try {
      connection.requestMethod = "POST"
      connection.connectTimeout = TIMEOUT_MS
      connection.readTimeout = TIMEOUT_MS
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
      connection.setRequestProperty("User-Agent", "NeteaseMusic/$APP_VERSION Android")
      connection.setRequestProperty("Cookie", encodeCookie(header))
      val form = "params=${URLEncoder.encode(params, StandardCharsets.UTF_8.name())}"
      connection.outputStream.use { it.write(form.toByteArray(StandardCharsets.UTF_8)) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.bufferedReader(StandardCharsets.UTF_8)?.use { reader ->
        val buffer = CharArray(8_192)
        val textBuilder = StringBuilder()
        while (true) {
          val count = reader.read(buffer)
          if (count < 0) break
          if (textBuilder.length + count > MAX_RESPONSE_CHARACTERS) {
            return PublicDataResult.Failure(PublicDataFailure(
              PublicDataFailureCode.INVALID_RESPONSE,
              "网易云响应超过大小上限",
            ))
          }
          textBuilder.append(buffer, 0, count)
        }
        textBuilder.toString()
      }.orEmpty()
      val body = try {
        JSONObject(text)
      } catch (_: Exception) {
        return PublicDataResult.Failure(PublicDataFailure(
          PublicDataFailureCode.INVALID_RESPONSE,
          "网易云返回了无法解析的 JSON",
        ))
      }
      PublicDataResult.Success(EapiResponse(status, body))
    } catch (error: IOException) {
      networkFailure(error)
    } finally {
      connection.disconnect()
    }
  }

  private fun createHeader(): JSONObject = JSONObject()
    .put("osver", "14")
    .put("deviceId", deviceId)
    .put("os", "android")
    .put("appver", APP_VERSION)
    .put("versioncode", "140")
    .put("mobilename", "")
    .put("buildver", (System.currentTimeMillis() / 1000L).toString())
    .put("resolution", "1920x1080")
    .put("__csrf", "")
    .put("channel", "xiaomi")
    .put("requestId", "${System.currentTimeMillis()}_${random.nextInt(1000).toString().padStart(4, '0')}")

  private fun encodeCookie(header: JSONObject): String = header.keys().asSequence().joinToString("; ") { key ->
    "${URLEncoder.encode(key, StandardCharsets.UTF_8.name())}=" +
      URLEncoder.encode(header.getString(key), StandardCharsets.UTF_8.name())
  }

  private fun networkFailure(error: IOException) = PublicDataResult.Failure(PublicDataFailure(
    PublicDataFailureCode.NETWORK_FAILURE,
    error.message ?: error.javaClass.simpleName,
  ))
}
