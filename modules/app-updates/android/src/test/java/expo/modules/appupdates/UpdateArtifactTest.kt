package expo.modules.appupdates

import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class UpdateArtifactTest {
  private fun withArchive(entries: Map<String, String>, block: (File, File) -> Unit) {
    val directory = Files.createTempDirectory("update-archive-").toFile()
    try {
      val archive = File(directory, "download.zip")
      ZipOutputStream(archive.outputStream()).use { zip ->
        entries.forEach { (name, content) ->
          zip.putNextEntry(ZipEntry(name))
          zip.write(content.toByteArray())
          zip.closeEntry()
        }
      }
      block(archive, File(directory, "update.apk"))
    } finally {
      directory.deleteRecursively()
    }
  }

  private fun withFile(block: (File) -> Unit) {
    val file = File.createTempFile("update-artifact-", ".apk")
    try {
      file.writeText("abc")
      block(file)
    } finally {
      file.delete()
    }
  }

  @Test fun acceptsExactArtifact() = withFile {
    verifyUpdateArtifact(it, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3)
  }

  @Test fun rejectsIncompleteDownload() = withFile {
    assertThrows(IllegalArgumentException::class.java) {
      verifyUpdateArtifact(it, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 4)
    }
  }

  @Test fun rejectsChangedBytesWithSameSize() = withFile {
    it.writeText("abd")
    assertThrows(IllegalArgumentException::class.java) {
      verifyUpdateArtifact(it, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3)
    }
  }

  @Test fun extractsOnlyTheExpectedApkAndVerifiesOriginalBytes() = withArchive(mapOf(
    "RavenCat-2.1.4.apk" to "abc",
    "SHA256SUMS.txt" to "not used as a trust source",
    "RavenCat-2.1.4-third-party-notices.zip" to "notices",
    "nested/another.apk" to "other",
    "../unexpected.txt" to "outside",
  )) { archive, output ->
    extractUpdateArtifact(archive, output, "RavenCat-2.1.4.apk", 3)
    verifyUpdateArtifact(output, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3)
    assertEquals("abc", output.readText())
    assertEquals(setOf(archive.name, output.name), output.parentFile!!.list()!!.toSet())
  }

  @Test fun rejectsArchiveWithoutTheExpectedVersion() = withArchive(mapOf(
    "RavenCat-2.1.3.apk" to "abc",
  )) { archive, output ->
    assertThrows(IllegalArgumentException::class.java) {
      extractUpdateArtifact(archive, output, "RavenCat-2.1.4.apk", 3)
    }
    assertFalse(output.exists())
  }

  @Test fun rejectsNonZipResponseWithoutLeavingAnApk() = withArchive(emptyMap()) { archive, output ->
    archive.writeText("<html>download unavailable</html>")
    assertThrows(java.util.zip.ZipException::class.java) {
      extractUpdateArtifact(archive, output, "RavenCat-2.1.4.apk", 3)
    }
    assertFalse(output.exists())
  }

  @Test fun limitsDecompressedBytesAndRemovesPartialApk() = withArchive(mapOf(
    "RavenCat-2.1.4.apk" to "a".repeat(65537),
  )) { archive, output ->
    assertThrows(IllegalArgumentException::class.java) {
      extractUpdateArtifact(archive, output, "RavenCat-2.1.4.apk", 65536)
    }
    assertFalse(output.exists())
  }

  @Test fun rejectsChangedApkInsideArchive() = withArchive(mapOf(
    "RavenCat-2.1.4.apk" to "abd",
  )) { archive, output ->
    extractUpdateArtifact(archive, output, "RavenCat-2.1.4.apk", 3)
    assertThrows(IllegalArgumentException::class.java) {
      verifyUpdateArtifact(output, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", 3)
    }
  }
}
