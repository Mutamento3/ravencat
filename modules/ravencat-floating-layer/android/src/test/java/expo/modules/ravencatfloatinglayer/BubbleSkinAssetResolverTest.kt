package expo.modules.ravencatfloatinglayer

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class BubbleSkinAssetResolverTest {
  @Test
  fun `resolves an existing backing file by its stable filename`() {
    val root = Files.createTempDirectory("ravencat-bubble-skins").toFile()
    try {
      val expected = File(root, "user-asset.svg").apply { writeText("<svg />") }

      assertEquals(
        expected.canonicalFile,
        BubbleSkinAssetResolver.resolveFile(root, "user-asset.svg"),
      )
    } finally {
      root.deleteRecursively()
    }
  }

  @Test
  fun `rejects uri absolute path and traversal storage keys`() {
    val root = Files.createTempDirectory("ravencat-bubble-skins").toFile()
    try {
      File(root, "user-asset.svg").writeText("<svg />")

      listOf(
        "file:///data/user/0/app/files/ravencat/bubble-skins/user-asset.svg",
        "content://media/external/images/1",
        "/data/user/0/app/files/user-asset.svg",
        "C:\\data\\user-asset.svg",
        "../user-asset.svg",
        "nested/user-asset.svg",
        "%2e%2e%2fuser-asset.svg",
      ).forEach { storageKey ->
        assertRejected(root, storageKey)
      }
    } finally {
      root.deleteRecursively()
    }
  }

  @Test
  fun `returns missing for absent and non-regular backing entries`() {
    val root = Files.createTempDirectory("ravencat-bubble-skins").toFile()
    try {
      File(root, "nested").mkdir()

      assertNull(BubbleSkinAssetResolver.resolveFile(root, "missing.svg"))
      assertNull(BubbleSkinAssetResolver.resolveFile(root, "nested"))
    } finally {
      root.deleteRecursively()
    }
  }

  private fun assertRejected(root: File, storageKey: String) {
    try {
      BubbleSkinAssetResolver.resolveFile(root, storageKey)
      fail("storageKey should be rejected: $storageKey")
    } catch (_: IllegalArgumentException) {
      // 解析边界以 IllegalArgumentException 报告非法 locator。
    }
  }
}
