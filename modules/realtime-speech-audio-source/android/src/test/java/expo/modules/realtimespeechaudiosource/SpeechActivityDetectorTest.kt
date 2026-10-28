package expo.modules.realtimespeechaudiosource

import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder

class SpeechActivityDetectorTest {
  @Test fun noiseClassificationNeverInterruptsEvenAtHighAmplitude() {
    val detector = SpeechActivityDetector(320) { false }
    assertFalse(detector.accept(pcmFrames(100, 30000)))
  }

  @Test fun sustainedQuietSpeechConfirmsWithoutAnAmplitudeGate() {
    val detector = SpeechActivityDetector(320) { true }
    assertFalse(detector.accept(pcmFrames(7, 50)))
    assertTrue(detector.accept(pcmFrames(1, 50)))
  }

  @Test fun isolatedPositiveBurstsDoNotAccumulateIntoSpeech() {
    val decisions = ArrayDeque(List(7) { true } + false + List(7) { true })
    val detector = SpeechActivityDetector(320) { decisions.removeFirst() }
    assertFalse(detector.accept(pcmFrames(15)))
  }

  @Test fun repeatedDetectionsFollowAudioDuration() {
    val detector = SpeechActivityDetector(320) { true }
    assertTrue(detector.accept(pcmFrames(8)))
    assertFalse(detector.accept(pcmFrames(39)))
    assertTrue(detector.accept(pcmFrames(1)))
  }

  @Test fun silenceRequiresFreshSpeechConfirmationAfterDetection() {
    val decisions = ArrayDeque(List(8) { true } + List(40) { false } + List(8) { true })
    val detector = SpeechActivityDetector(320) { decisions.removeFirst() }
    assertTrue(detector.accept(pcmFrames(8)))
    assertFalse(detector.accept(pcmFrames(40)))
    assertFalse(detector.accept(pcmFrames(7)))
    assertTrue(detector.accept(pcmFrames(1)))
  }

  @Test fun pcmFramingPreservesSignedSamplesAcrossCaptureChunkBoundaries() {
    val samples = ShortArray(320 * 8) { shortArrayOf(-32768, -1, 0, 32767)[it % 4] }
    val pcm = ByteBuffer.allocate(samples.size * 2).order(ByteOrder.LITTLE_ENDIAN)
    samples.forEach { pcm.putShort(it) }

    for (chunkSize in listOf(2, 6, 638, 1280, 6400)) {
      val received = mutableListOf<Short>()
      val detector = SpeechActivityDetector(320) {
        received.addAll(it.toList())
        true
      }
      var detections = 0
      for (offset in pcm.array().indices step chunkSize) {
        if (detector.accept(pcm.array().copyOfRange(offset, minOf(offset + chunkSize, pcm.capacity())))) {
          detections++
        }
      }
      assertArrayEquals(samples, received.toShortArray())
      assertEquals(1, detections)
    }
  }

  private fun pcmFrames(count: Int, amplitude: Int = 100): ByteArray {
    val bytes = ByteBuffer.allocate(count * 320 * 2).order(ByteOrder.LITTLE_ENDIAN)
    repeat(count * 320) { bytes.putShort(amplitude.toShort()) }
    return bytes.array()
  }
}
