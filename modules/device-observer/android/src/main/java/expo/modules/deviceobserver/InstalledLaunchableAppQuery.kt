package expo.modules.deviceobserver

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import java.io.File
import java.io.FileOutputStream

private class InstalledAppsQueryException(cause: Exception) :
  CodedException("无法读取 Android 桌面应用列表", cause)

/** 只查询 Manifest 可见的 Launcher 应用，并把缩略图缓存在应用私有 cache。 */
internal class InstalledLaunchableAppQuery(private val context: Context) {
  private val packageManager = context.packageManager
  private val iconCacheDirectory = File(context.cacheDir, ICON_CACHE_DIRECTORY)
  private val iconSizePx = (ICON_SIZE_DP * context.resources.displayMetrics.density)
    .toInt()
    .coerceAtLeast(ICON_SIZE_DP)

  fun query(): List<Map<String, Any?>> {
    try {
      val launcherIntent = Intent(Intent.ACTION_MAIN).apply {
        addCategory(Intent.CATEGORY_LAUNCHER)
      }
      val resolveInfos = packageManager.queryIntentActivities(
        launcherIntent,
        PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_ALL.toLong()),
      )
      val appsByPackage = linkedMapOf<String, Map<String, Any?>>()

      resolveInfos.forEach { resolveInfo ->
        val applicationInfo = resolveInfo.activityInfo?.applicationInfo ?: return@forEach
        val packageName = applicationInfo.packageName?.trim().orEmpty()
        if (packageName.isEmpty() || packageName == context.packageName) {
          return@forEach
        }

        val label = resolveInfo.loadLabel(packageManager)?.toString()?.trim()
          ?.takeIf { it.isNotEmpty() }
          ?: packageName
        val systemFlags = ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP
        appsByPackage.putIfAbsent(
          packageName,
          mapOf(
            "packageName" to packageName,
            "label" to label,
            "iconDataUri" to loadIconDataUri(applicationInfo),
            "isSystemApp" to (applicationInfo.flags and systemFlags != 0),
          ),
        )
      }

      return appsByPackage.values.sortedBy { it["packageName"] as String }
    } catch (error: Exception) {
      throw InstalledAppsQueryException(error)
    }
  }

  fun clearIconCache() {
    if (!iconCacheDirectory.exists()) {
      return
    }
    iconCacheDirectory.listFiles()?.forEach { cachedFile ->
      if (cachedFile.isFile) {
        cachedFile.delete()
      }
    }
  }

  private fun loadIconDataUri(applicationInfo: ApplicationInfo): String? {
    return try {
      val iconFile = resolveIconCacheFile(applicationInfo)
      if (!iconFile.exists()) {
        iconCacheDirectory.mkdirs()
        val bitmap = drawableToBitmap(applicationInfo.loadIcon(packageManager))
        FileOutputStream(iconFile).use { output ->
          check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
            "应用图标 PNG 编码失败"
          }
        }
        bitmap.recycle()
      }
      val encoded = Base64.encodeToString(iconFile.readBytes(), Base64.NO_WRAP)
      "data:image/png;base64,$encoded"
    } catch (_: Exception) {
      null
    }
  }

  private fun resolveIconCacheFile(applicationInfo: ApplicationInfo): File {
    val packagePrefix = applicationInfo.packageName.replace(Regex("[^a-zA-Z0-9._-]"), "_")
    val sourceRevision = File(applicationInfo.sourceDir).lastModified().coerceAtLeast(0L)
    val expectedName = "${packagePrefix}_${sourceRevision}_${iconSizePx}.png"
    iconCacheDirectory.listFiles()?.forEach { cachedFile ->
      if (cachedFile.name.startsWith("${packagePrefix}_") && cachedFile.name != expectedName) {
        cachedFile.delete()
      }
    }
    return File(iconCacheDirectory, expectedName)
  }

  private fun drawableToBitmap(drawable: Drawable): Bitmap {
    val source = (drawable as? BitmapDrawable)?.bitmap
    if (source != null && source.width == iconSizePx && source.height == iconSizePx) {
      return source.copy(Bitmap.Config.ARGB_8888, false)
    }

    val bitmap = Bitmap.createBitmap(iconSizePx, iconSizePx, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    drawable.setBounds(0, 0, canvas.width, canvas.height)
    drawable.draw(canvas)
    return bitmap
  }

  private companion object {
    const val ICON_CACHE_DIRECTORY = "installed-launchable-app-icons"
    const val ICON_SIZE_DP = 48
  }
}
