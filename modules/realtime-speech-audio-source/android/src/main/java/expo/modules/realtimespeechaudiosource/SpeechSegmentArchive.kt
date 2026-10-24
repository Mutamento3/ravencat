package expo.modules.realtimespeechaudiosource

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

/** PCM 写盘而非累积 JS 内存；ASR 时间轴与实际发送的 16kHz 单声道采集时间轴相同。 */
internal class SpeechSegmentArchive(private val root: File, private val sampleRate: Int) {
  val id: String = UUID.randomUUID().toString()
  private val source = File(root, "$id.pcm")
  private val output: RandomAccessFile

  init {
    root.mkdirs()
    output = RandomAccessFile(source, "rw")
  }

  @Synchronized fun append(bytes: ByteArray, length: Int) {
    output.seek(output.length())
    output.write(bytes, 0, length)
  }

  @Synchronized fun export(startMs: Double, endMs: Double, targetRoot: File): Pair<File, Double> {
    require(startMs.isFinite() && endMs.isFinite() && startMs >= 0 && endMs > startMs) { "无效的识别音频时间范围" }
    val start = (startMs * sampleRate / 1000).toLong() * 2
    val end = minOf((endMs * sampleRate / 1000).toLong() * 2, output.length())
    require(end > start) { "识别音频不在当前录音时间轴内" }
    val size = end - start
    require(size <= Int.MAX_VALUE - 44) { "语音片段过长" }
    targetRoot.mkdirs()
    val target = File(targetRoot, "call-${UUID.randomUUID()}.wav")
    try {
      target.outputStream().use { stream ->
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
        header.put("RIFF".toByteArray()).putInt(36 + size.toInt()).put("WAVEfmt ".toByteArray())
          .putInt(16).putShort(1).putShort(1).putInt(sampleRate).putInt(sampleRate * 2)
          .putShort(2).putShort(16).put("data".toByteArray()).putInt(size.toInt())
        stream.write(header.array())
        output.seek(start)
        var remaining = size
        val buffer = ByteArray(8192)
        while (remaining > 0) {
          val count = minOf(remaining, buffer.size.toLong()).toInt()
          output.readFully(buffer, 0, count)
          stream.write(buffer, 0, count)
          remaining -= count
        }
      }
      return target to size * 1000.0 / (sampleRate * 2)
    } catch (error: Exception) {
      target.delete()
      throw error
    }
  }

  @Synchronized fun close() {
    try { output.close() } finally { source.delete() }
  }
}
