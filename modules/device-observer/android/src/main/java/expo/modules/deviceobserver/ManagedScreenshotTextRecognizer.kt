package expo.modules.deviceobserver

import android.content.Context
import android.net.Uri
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions

/**
 * 对已经冻结的 RavenCat 设备观察截图执行本地 OCR。
 *
 * 这里只是 OCR 的原生实现适配层：不识别当前窗口、不读取 Protected Apps、不重新截图，
 * 也不决定识别结果如何呈现给模型。中文识别器同时覆盖 Latin，因此不并行运行第二个识别器。
 */
internal class ManagedScreenshotTextRecognizer(
  private val context: Context,
) {
  fun recognize(uri: String): DeviceOcrSnapshot {
    val file = ManagedScreenshotFile.resolve(ManagedScreenshotFile.directory(context), uri)
      ?: throw DeviceOcrException(
        "invalid_ocr_input",
        "OCR 只接受 RavenCat 自己管理的设备观察截图",
      )
    if (!file.isFile) {
      throw DeviceOcrException(
        "invalid_ocr_input",
        "设备观察截图已不存在，无法执行 OCR",
      )
    }

    // 一次请求一个识别器，process 结束后立即释放，不保留全局长期对象。
    val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    return try {
      val image = InputImage.fromFilePath(context, Uri.fromFile(file))
      val text = Tasks.await(recognizer.process(image))
      DeviceOcrSnapshotBuilder.build(
        text.textBlocks.map { block ->
          RawOcrBlock(lines = block.lines.map { line -> line.text })
        },
      )
    } catch (error: Exception) {
      throw DeviceOcrException("ocr_failed", "本地 OCR 识别失败", error)
    } finally {
      recognizer.close()
    }
  }
}
