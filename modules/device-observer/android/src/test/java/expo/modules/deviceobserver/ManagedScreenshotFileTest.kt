package expo.modules.deviceobserver

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class ManagedScreenshotFileTest {
  @get:Rule
  val cacheDirectory = TemporaryFolder()

  @Test
  fun `resolves managed screenshot inside cache directory`() {
    val root = File(cacheDirectory.root, "device-observer")
    root.mkdirs()
    val screenshot = File(root, "ravencat_1_100.png")
    screenshot.writeText("png")

    assertEquals(
      screenshot.canonicalFile,
      ManagedScreenshotFile.resolve(root, fileUri(screenshot)),
    )
  }

  @Test
  fun `rejects files outside managed cache directory`() {
    val root = File(cacheDirectory.root, "device-observer")
    root.mkdirs()
    val outside = cacheDirectory.newFile("outside.png")

    assertNull(ManagedScreenshotFile.resolve(root, fileUri(outside)))
  }

  @Test
  fun `rejects missing nested file paths`() {
    val root = File(cacheDirectory.root, "device-observer")
    root.mkdirs()

    assertNull(
      ManagedScreenshotFile.resolve(
        root,
        fileUri(File(File(root, "sub-directory"), "escaped.png")),
      ),
    )
  }

  @Test
  fun `rejects malformed and non-file uris`() {
    val root = File(cacheDirectory.root, "device-observer")

    for (uri in listOf(
      "",
      "file://",
      "file:/cache/device-observer/x.png",
      "/data/data/com.ravencat/cache/device-observer/x.png",
      "content://media/external/images/media/1",
      "https://example.com/device-observer/x.png",
    )) {
      assertNull("uri=$uri 应被拒绝", ManagedScreenshotFile.resolve(root, uri))
    }
  }

  private fun fileUri(file: File): String {
    return "file://${file.absolutePath.replace(File.separatorChar, '/')}"
  }
}
