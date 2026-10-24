package expo.modules.realtimespeechaudiosource

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files

class SpeechSegmentArchiveTest {
  @Test fun exportsSeparateWavSegmentsAndDeletesOnlyRawSourceOnClose() {
    val root = Files.createTempDirectory("call-segments").toFile()
    try {
      val source = root.resolve("source")
      val archive = SpeechSegmentArchive(source, 16000)
      val pcm = ByteArray(16000 * 2 * 4) { (it % 127).toByte() }
      archive.append(pcm, pcm.size)
      val (first, duration) = archive.export(500.0, 2800.0, root.resolve("speech"))
      assertEquals(2300.0, duration, 0.01)
      val wav = first.readBytes()
      assertEquals("RIFF", String(wav, 0, 4))
      assertEquals("WAVE", String(wav, 8, 4))
      assertEquals(16000, ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN).getInt(24))
      assertArrayEquals(pcm.copyOfRange(16000, 89600), wav.copyOfRange(44, wav.size))
      val (second, secondDuration) = archive.export(2800.0, 4200.0, root.resolve("speech"))
      assertEquals(1200.0, secondDuration, 0.01)
      assertNotEquals(first, second)
      archive.close()
      assertEquals(0, source.listFiles()!!.size)
      assertTrue(first.exists())
      assertTrue(second.exists())
    } finally { root.deleteRecursively() }
  }

  @Test fun rejectsInvalidExternalTimestamps() {
    val root = Files.createTempDirectory("call-invalid-segment").toFile()
    try {
      val archive = SpeechSegmentArchive(root, 16000)
      archive.append(ByteArray(32000), 32000)
      for ((start, end) in listOf(-1.0 to 200.0, 100.0 to 100.0, 200.0 to 100.0, Double.NaN to 200.0, 2000.0 to 2200.0)) {
        assertThrows(IllegalArgumentException::class.java) { archive.export(start, end, root) }
      }
      archive.close()
    } finally { root.deleteRecursively() }
  }
}
