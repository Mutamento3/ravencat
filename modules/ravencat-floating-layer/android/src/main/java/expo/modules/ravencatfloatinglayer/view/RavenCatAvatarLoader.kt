package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import java.io.File

/**
 * 悬浮层头像的本地解码入口。
 *
 * Host 下发的 avatar URI 是 app 沙盒内 persistent-media 的 file:// 绝对路径，
 * legacy 数据可能是 content:// 或 http(s)。这里只做本地解码：http(s) 不引入
 * 网络加载直接落空；任何失败都返回 null，由调用方统一退回首字 fallback。
 */
internal object RavenCatAvatarLoader {
  fun loadLocalAvatar(context: Context, uri: String?, targetSizePx: Int): Bitmap? {
    val normalized = uri?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val target = targetSizePx.coerceAtLeast(1)
    return when {
      normalized.startsWith("http://") || normalized.startsWith("https://") -> null
      normalized.startsWith("content://") -> decodeContent(context, normalized, target)
      else -> {
        val path = if (normalized.startsWith("file://")) {
          Uri.parse(normalized).path ?: return null
        } else {
          normalized
        }
        decodeFile(path, target)
      }
    }
  }

  private fun decodeFile(path: String, targetSizePx: Int): Bitmap? {
    // 头像文件被清理后不存在是预期路径，直接落空，不打 noisy 日志。
    if (!File(path).isFile) return null
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    return BitmapFactory.decodeFile(
      path,
      BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, targetSizePx)
      },
    )
  }

  private fun decodeContent(context: Context, uri: String, targetSizePx: Int): Bitmap? {
    return try {
      val parsed = Uri.parse(uri)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      context.contentResolver.openInputStream(parsed)?.use { input ->
        BitmapFactory.decodeStream(input, null, bounds)
      } ?: return null
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      context.contentResolver.openInputStream(parsed)?.use { input ->
        BitmapFactory.decodeStream(
          input,
          null,
          BitmapFactory.Options().apply {
            inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, targetSizePx)
          },
        )
      }
    } catch (_: Exception) {
      // legacy content:// 授权可能已失效，resolver 抛异常时退回首字 fallback。
      null
    }
  }

  /** 2 的幂采样，把大图压到 [targetSizePx, 2 * targetSizePx) 区间，避免原图全量进内存。 */
  private fun sampleSize(outWidth: Int, outHeight: Int, targetSizePx: Int): Int {
    var sample = 1
    while (maxOf(outWidth, outHeight) / (sample * 2) >= targetSizePx) {
      sample *= 2
    }
    return sample
  }
}
