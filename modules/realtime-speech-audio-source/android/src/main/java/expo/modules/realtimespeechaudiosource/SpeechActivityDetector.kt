package expo.modules.realtimespeechaudiosource

/**
 * 把采集块还原为 20ms PCM 帧，只有持续人声才允许触发打断。
 * 采集块大小由 AudioRecord 决定，不能把块数当作人声持续时间。
 */
internal class SpeechActivityDetector(
  frameSize: Int,
  private val classifySpeech: (ShortArray) -> Boolean,
) {
  private val frame = ShortArray(frameSize)
  private var frameOffset = 0
  private var speechFrames = 0
  private var framesSinceDetection = DETECTION_INTERVAL_FRAMES

  fun accept(pcm: ByteArray): Boolean {
    var detected = false
    // PCM16 的样本对齐由 AudioRecord 的读取契约保证。
    for (index in pcm.indices step 2) {
      val low = pcm[index].toInt() and 0xff
      frame[frameOffset++] = ((pcm[index + 1].toInt() shl 8) or low).toShort()
      if (frameOffset != frame.size) continue
      frameOffset = 0

      framesSinceDetection = (framesSinceDetection + 1).coerceAtMost(DETECTION_INTERVAL_FRAMES)
      speechFrames = if (classifySpeech(frame)) {
        (speechFrames + 1).coerceAtMost(CONFIRMATION_FRAMES)
      } else {
        0
      }
      if (speechFrames == CONFIRMATION_FRAMES && framesSinceDetection == DETECTION_INTERVAL_FRAMES) {
        framesSinceDetection = 0
        detected = true
      }
    }
    return detected
  }

  private companion object {
    // 160ms 连续人声过滤短促噪声；重复通知按音频时长限流，不依赖桥接或系统时钟。
    const val CONFIRMATION_FRAMES = 8
    const val DETECTION_INTERVAL_FRAMES = 40
  }
}
