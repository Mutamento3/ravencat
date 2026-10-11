package expo.modules.appupdates

import java.io.File
import org.junit.Assert.assertThrows
import org.junit.Test

class UpdateArtifactTest {
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
}
