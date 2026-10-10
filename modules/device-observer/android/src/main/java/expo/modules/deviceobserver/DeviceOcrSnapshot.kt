package expo.modules.deviceobserver

import expo.modules.kotlin.exception.CodedException

internal class DeviceOcrException(
  val reason: String,
  message: String,
  cause: Throwable? = null,
) : CodedException(
  "ERR_DEVICE_OCR_${reason.uppercase()}",
  message,
  cause,
)

internal data class DeviceOcrLine(
  val text: String,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "text" to text,
  )
}

/** block 文本由消费方从保留的 lines deterministic 派生；bridge 不重复传一份 block.text。 */
internal data class DeviceOcrBlock(
  val lines: List<DeviceOcrLine>,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "lines" to lines.map(DeviceOcrLine::toMap),
  )
}

internal data class DeviceOcrTruncation(
  val blockLimitReached: Boolean,
  val lineLimitReached: Boolean,
  val characterLimitReached: Boolean,
) {
  fun toMap(): Map<String, Boolean> = mapOf(
    "blockLimitReached" to blockLimitReached,
    "lineLimitReached" to lineLimitReached,
    "characterLimitReached" to characterLimitReached,
  )
}

internal data class DeviceOcrSnapshot(
  val blocks: List<DeviceOcrBlock>,
  val truncation: DeviceOcrTruncation,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "blocks" to blocks.map(DeviceOcrBlock::toMap),
    "truncation" to truncation.toMap(),
  )
}

/** 识别器产出的纯文本形状；只有这一层知道 ML Kit 类型，便于 JVM 单测覆盖裁剪规则。 */
internal data class RawOcrBlock(
  val lines: List<String>,
)

/**
 * 原生硬上限：只负责防止 Android 边界把无界 payload 送过桥。
 *
 * 产品级上限属于 Screen Observation application contract，这里的数值始终比它更宽松。
 */
internal object DeviceOcrSnapshotBuilder {
  private const val MAX_BLOCKS = 1_024
  private const val MAX_LINES = 4_096
  private const val MAX_LINE_CHARACTERS = 8_000
  private const val MAX_TOTAL_CHARACTERS = 262_144

  fun build(rawBlocks: List<RawOcrBlock>): DeviceOcrSnapshot {
    val blocks = mutableListOf<DeviceOcrBlock>()
    var lineCount = 0
    var totalCharacters = 0
    var blockLimitReached = false
    var lineLimitReached = false
    var characterLimitReached = false

    for (rawBlock in rawBlocks) {
      if (blocks.size >= MAX_BLOCKS) {
        blockLimitReached = true
        break
      }
      if (lineCount >= MAX_LINES) {
        lineLimitReached = true
        break
      }
      val lines = mutableListOf<DeviceOcrLine>()
      for (rawLine in rawBlock.lines) {
        if (lineCount >= MAX_LINES) {
          lineLimitReached = true
          break
        }
        val remaining = MAX_TOTAL_CHARACTERS - totalCharacters
        if (remaining <= 0) {
          characterLimitReached = true
          break
        }
        val normalized = normalize(rawLine)
        if (normalized.isEmpty()) continue
        val fitted = normalized.take(minOf(MAX_LINE_CHARACTERS, remaining)).takeIf(String::isNotEmpty)
        if (fitted == null) continue
        if (fitted.length < normalized.length) characterLimitReached = true
        totalCharacters += fitted.length
        lines.add(DeviceOcrLine(fitted))
        lineCount += 1
      }
      if (lines.isEmpty()) continue
      blocks.add(DeviceOcrBlock(lines = lines))
    }

    return DeviceOcrSnapshot(
      blocks = blocks,
      truncation = DeviceOcrTruncation(
        blockLimitReached = blockLimitReached,
        lineLimitReached = lineLimitReached,
        characterLimitReached = characterLimitReached,
      ),
    )
  }

  /** 只处理首尾空白与换行形式；行内空白可能本身有意义，不做压缩。 */
  private fun normalize(value: String): String {
    return value.replace("\r\n", "\n").replace('\r', '\n').trim()
  }
}
