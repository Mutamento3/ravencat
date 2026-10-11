package expo.modules.appupdates

import android.content.Intent
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private class UpdateException(message: String, cause: Exception) : CodedException(message, cause)

class AppUpdatesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RavenCatAppUpdates")

    Function("isUpdateInstallAllowed") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      context.packageManager.canRequestPackageInstalls()
    }

    AsyncFunction("openUpdateInstallSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      openInstallSettings(context)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("verifyDownloadedUpdate") Coroutine { uri: String, sha256: String, size: Double, version: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        try {
          val parsed = Uri.parse(uri)
          require(parsed.scheme == "file") { "更新安装包必须是本地文件" }
          val file = File(requireNotNull(parsed.path)).canonicalFile
          val directory = File(context.cacheDir, "app-updates").canonicalFile
          require(file.parentFile == directory) { "更新文件不在专用缓存目录" }
          verifyUpdateArtifact(file, sha256, size.toLong())
          val info = context.packageManager.getPackageArchiveInfo(file.path, PackageManager.PackageInfoFlags.of(0L))
          require(info != null && info.packageName == context.packageName && info.versionName == version) {
            "安装包的应用或版本与当前更新不一致"
          }
        } catch (error: Exception) {
          throw UpdateException("无法验证更新：${error.message}", error)
        }
      }
    }

    AsyncFunction("openUpdateInstaller") { verifiedUri: String ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      try {
        if (!activity.packageManager.canRequestPackageInstalls()) {
          openInstallSettings(activity)
          "permission_required"
        } else {
          // 输入已由 verifyDownloadedUpdate 校验；签名和是否允许覆盖安装由 Android 安装器负责。
          val file = File(requireNotNull(Uri.parse(verifiedUri).path))
          val contentUri = FileProvider.getUriForFile(activity,
            "${activity.packageName}.FileSystemFileProvider", file)
          activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(contentUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          })
          "opened"
        }
      } catch (error: Exception) {
        throw UpdateException("无法打开更新安装页：${error.message}", error)
      }
    }.runOnQueue(Queues.MAIN)
  }

  private fun openInstallSettings(context: Context) {
    context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }
}
