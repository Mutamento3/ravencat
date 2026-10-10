package expo.modules.deviceobserver

import android.graphics.Bitmap

internal data class CapturedScreenshotBitmap(
  val bitmap: Bitmap,
  val capturedAtEpochMs: Long,
)

internal data class DeviceScreenshot(
  val uri: String,
  val width: Int,
  val height: Int,
  val mimeType: String,
  val capturedAtEpochMs: Long,
  val packageName: String?,
  val windowId: Int?,
  val source: String,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "uri" to uri,
      "width" to width,
      "height" to height,
      "mimeType" to mimeType,
      "capturedAtEpochMs" to capturedAtEpochMs,
      "packageName" to packageName,
      "windowId" to windowId,
      "source" to source,
    )
  }
}
