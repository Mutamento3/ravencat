package expo.modules.backupstorage

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import java.io.File
import java.io.InputStream
import java.util.UUID

internal data class PreparedRestore(
  val restoreId: String,
  val createdAt: String,
  val appVersion: String,
  val stableSettingsJson: String,
  val bubbleSkinRootUri: String,
  val mediaRootUri: String,
  val databaseUri: String,
)

internal object BackupRestoreEngine {
  fun prepare(
    context: Context,
    artifactLocator: String,
    currentDatabaseContractVersion: Int,
  ): PreparedRestore {
    val restoreId = UUID.randomUUID().toString()
    val staging = File(context.filesDir, "backup-restore-staging/$restoreId")
    staging.mkdirs()

    try {
      val manifest = openArtifact(context, artifactLocator).use { input ->
        BackupArchive.extract(input, staging, currentDatabaseContractVersion)
      }
      verifyDatabase(File(staging, "database/raven.db"))
      return PreparedRestore(
        restoreId = restoreId,
        createdAt = manifest.getString("createdAt"),
        appVersion = manifest.getString("appVersion"),
        stableSettingsJson = File(staging, "settings/stable-settings.json")
          .readText(Charsets.UTF_8),
        bubbleSkinRootUri = Uri.fromFile(File(staging, "files/ravencat/bubble-skins"))
          .toString(),
        // staging 中 persistent-media 的只读根：stable settings owner 在 activate 之前用它
        // 校验 incoming 壁纸 / 通话背景引用，不能拿当前运行时 filesDir 去检查 staging。
        mediaRootUri = Uri.fromFile(File(staging, "media/persistent-media")).toString(),
        databaseUri = Uri.fromFile(File(staging, "database/raven.db")).toString(),
      )
    } catch (error: Exception) {
      staging.deleteRecursively()
      throw error
    }
  }

  private fun verifyDatabase(databaseFile: File) {
    if (!databaseFile.isFile) throw IllegalArgumentException("备份数据库不存在")
    val database = SQLiteDatabase.openDatabase(
      databaseFile.path,
      null,
      SQLiteDatabase.OPEN_READONLY,
    )
    database.use {
      it.rawQuery("PRAGMA integrity_check", null).use { cursor ->
        if (!cursor.moveToFirst() || cursor.getString(0) != "ok") {
          throw IllegalArgumentException("备份数据库完整性检查失败")
        }
      }
      it.rawQuery("PRAGMA foreign_key_check", null).use { cursor ->
        if (cursor.moveToFirst()) {
          throw IllegalArgumentException("备份数据库外键检查失败")
        }
      }
    }
  }

  private fun openArtifact(context: Context, locator: String): InputStream {
    val uri = Uri.parse(locator)
    return when (uri.scheme) {
      "content" -> context.contentResolver.openInputStream(uri)
      "file" -> uri.path?.let(::File)?.inputStream()
      else -> null
    } ?: throw IllegalArgumentException("无法读取备份文件")
  }
}
