package expo.modules.deviceobserver

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.FileOutputStream

internal class DeviceScreenshotException(
  val reason: String,
  message: String,
  cause: Throwable? = null,
) : CodedException(
  "ERR_DEVICE_SCREENSHOT_${reason.uppercase()}",
  message,
  cause,
)

/** 只在 App 私有缓存目录写入和删除设备观察截图。 */
internal class AccessibilityScreenshotWriter(
  private val context: Context,
) {
  fun write(
    requestId: String,
    captured: CapturedScreenshotBitmap,
    windowState: DeviceWindowState,
    source: String,
  ): DeviceScreenshot {
    val directory = screenshotDirectory()
    if (!directory.exists() && !directory.mkdirs()) {
      captured.bitmap.recycle()
      throw DeviceScreenshotException(
        "image_write_failed",
        "无法创建设备观察截图缓存目录",
      )
    }
    cleanupExpiredFiles(directory)

    val safeRequestId = requestId
      .replace(UNSAFE_FILE_SEGMENT, "_")
      .take(MAX_REQUEST_ID_LENGTH)
      .ifBlank { "capture" }
    val screenshotFile = File(
      directory,
      "${safeRequestId}_${captured.capturedAtEpochMs}.png",
    )

    try {
      FileOutputStream(screenshotFile).use { output ->
        if (!captured.bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
          throw DeviceScreenshotException(
            "image_write_failed",
            "Android 无法编码设备观察截图",
          )
        }
      }
      return DeviceScreenshot(
        uri = Uri.fromFile(screenshotFile).toString(),
        width = captured.bitmap.width,
        height = captured.bitmap.height,
        mimeType = "image/png",
        capturedAtEpochMs = captured.capturedAtEpochMs,
        packageName = windowState.packageName,
        windowId = windowState.windowId,
        source = source,
      )
    } catch (error: DeviceScreenshotException) {
      screenshotFile.delete()
      throw error
    } catch (error: Exception) {
      screenshotFile.delete()
      throw DeviceScreenshotException(
        "image_write_failed",
        "设备观察截图写入失败",
        error,
      )
    } finally {
      captured.bitmap.recycle()
    }
  }

  fun delete(uri: String) {
    val target = ManagedScreenshotFile.resolve(screenshotDirectory(), uri)
      ?: throw DeviceScreenshotException(
        "image_write_failed",
        "只能删除 App 私有缓存中的设备观察截图",
      )

    if (target.exists() && !target.delete()) {
      throw DeviceScreenshotException(
        "image_write_failed",
        "设备观察截图删除失败",
      )
    }
  }

  private fun screenshotDirectory(): File {
    return ManagedScreenshotFile.directory(context)
  }

  private fun cleanupExpiredFiles(directory: File) {
    val expiresBefore = System.currentTimeMillis() - SCREENSHOT_CACHE_TTL_MS
    directory.listFiles()
      ?.filter { file -> file.isFile && file.lastModified() < expiresBefore }
      ?.forEach { file -> file.delete() }
  }

  companion object {
    private const val SCREENSHOT_CACHE_TTL_MS = 24 * 60 * 60 * 1000L
    private const val MAX_REQUEST_ID_LENGTH = 64
    private val UNSAFE_FILE_SEGMENT = Regex("[^a-zA-Z0-9._-]")
  }
}
