package expo.modules.webtools

import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.net.URI

class WebPrivateImageStoreTest {
  @get:Rule val folder = TemporaryFolder()

  private fun response() = Response.Builder().request(Request.Builder().url("https://example.com/cat.png").build())
    .protocol(Protocol.HTTP_1_1).code(200).message("OK").body(byteArrayOf(1, 2, 3).toResponseBody()).build()

  @Test fun downloadStaysInPrivateCacheAndCannotChoosePath() {
    val result = WebPrivateImageStore(folder.root).save(response(), "../../cat.png", WebRequest())
    val file = File(URI(result.getValue("uri") as String))
    assertTrue(file.canonicalPath.startsWith(folder.root.canonicalPath + File.separator))
    assertArrayEquals(byteArrayOf(1, 2, 3), file.readBytes())
    assertEquals(3L, result["sizeBytes"])
    assertFalse((result.getValue("fileName") as String).contains('/'))
    assertEquals("应用私有媒体库", result["directory"])
  }

  @Test fun cancellationDoesNotLeavePreparedFile() {
    val request = WebRequest().apply { cancel() }
    try {
      WebPrivateImageStore(folder.root).save(response(), null, request)
      fail("取消后不能保存图片")
    } catch (failure: WebFailure) {
      assertEquals("WEB_CANCELLED", failure.code)
    }
    assertTrue(File(folder.root, "ravencat-image-downloads").listFiles()!!.isEmpty())
  }
}
