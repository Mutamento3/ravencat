package expo.modules.backupstorage

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.provider.MediaStore
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.time.Instant
import java.util.UUID

private const val BACKUP_EXTENSION = ".ravenbackup"
private const val BACKUP_MIME_TYPE = "application/vnd.ravencat.backup"
private val DOWNLOAD_RELATIVE_PATH = "${Environment.DIRECTORY_DOWNLOADS}/RavenCat/"
private const val STALE_PENDING_AGE_SECONDS = 24 * 60 * 60L
private const val STALE_PENDING_CLEANUP_LIMIT = 100
private const val BACKUP_FILE_NAME_PREFIX = "RavenCat-Backup-"

private class BackupStorageException(message: String, cause: Throwable? = null) :
  CodedException(message, cause)

class BackupStorageModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackupStorage")

    AsyncFunction("prepareBackup") { options: Map<String, Any?> ->
      prepareBackup(options)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("publishToDownloads") { sourceLocator: String, fileName: String ->
      publishToDownloads(sourceLocator, fileName)
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("listPublishedBackups") {
      listPublishedBackups()
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("deletePublishedBackup") { artifactId: String ->
      deletePublishedBackup(artifactId)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("prepareRestore") { options: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      try {
        val prepared = BackupRestoreEngine.prepare(
          context,
          requireString(options, "artifactLocator"),
          (options["currentDatabaseContractVersion"] as? Number)?.toInt()
            ?: throw BackupStorageException("缺少数据库契约版本"),
        )
        mapOf(
          "restoreId" to prepared.restoreId,
          "createdAt" to prepared.createdAt,
          "appVersion" to prepared.appVersion,
          "stableSettingsJson" to prepared.stableSettingsJson,
          "bubbleSkinRootUri" to prepared.bubbleSkinRootUri,
          "mediaRootUri" to prepared.mediaRootUri,
          "databaseUri" to prepared.databaseUri,
        )
      } catch (error: Exception) {
        throw BackupStorageException(
          "无法校验备份：${error.message ?: "备份包已损坏"}",
          error,
        )
      }
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("discardPreparedRestore") { restoreId: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.discard(context, restoreId)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("activatePreparedRestoreAndExit") {
        restoreId: String,
        rollbackStableSettingsJson: String,
      ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.schedule(context, restoreId, rollbackStableSettingsJson)
      Handler(Looper.getMainLooper()).postDelayed({
        appContext.currentActivity?.finishAffinity()
        Process.killProcess(Process.myPid())
      }, 300)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("readPendingRestoreAction") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.readPendingAction(context)?.let { action ->
        buildMap<String, Any> {
          put("kind", action.kind)
          put("stableSettingsJson", action.stableSettingsJson)
          action.failureMessage?.let { put("failureMessage", it) }
        }
      }
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("commitActivatedRestore") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.commitActivatedRestore(context)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("rollbackActivatedRestore") { failureMessage: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.rollbackActivatedRestore(context, failureMessage)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("completeRolledBackRestore") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.completeRolledBackRestore(context)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("collectRestoreGarbage") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.collectGarbage(context)
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("consumeRestoreFailure") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackupRestoreBootstrap.consumeRestoreFailure(context)
    }.runOnQueue(Queues.DEFAULT)
  }

  private fun prepareBackup(options: Map<String, Any?>): Map<String, Any> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val snapshot = requireLocalFile(requireString(options, "databaseSnapshotUri"))
    val mediaRoot = requireLocalFile(requireString(options, "mediaRootUri"), allowMissing = true)
    val excludedMediaPrefixes = (options["excludedMediaStoragePrefixes"] as? List<*>)?.map { value ->
      val prefix = value as? String ?: throw BackupStorageException("媒体排除目录无效")
      if (!prefix.endsWith('/') || prefix.startsWith('/') || prefix.contains('\\') || prefix.contains(':') || prefix.split('/').dropLast(1).any { it.isEmpty() || it == "." || it == ".." }) {
        throw BackupStorageException("媒体排除目录必须是相对目录前缀")
      }
      prefix
    } ?: throw BackupStorageException("缺少媒体排除目录")
    val bubbleSkinRoot = requireLocalFile(requireString(options, "bubbleSkinRootUri"), allowMissing = true)
    val settingsBytes = requireString(options, "stableSettingsJson").toByteArray(Charsets.UTF_8)
    val createdAt = requireString(options, "createdAt")
    val appVersion = requireString(options, "appVersion")
    val databaseContractVersion = (options["databaseContractVersion"] as? Number)?.toInt()
      ?: throw BackupStorageException("缺少数据库契约版本")

    if (!snapshot.isFile) {
      throw BackupStorageException("数据库快照不存在")
    }

    val artifactDirectory = File(context.cacheDir, "backup-artifacts").apply { mkdirs() }
    val artifactId = UUID.randomUUID().toString()
    val safeTimestamp = createdAt.replace(Regex("[^0-9]"), "").take(14)
    val fileName = "RavenCat-Backup-$safeTimestamp-$artifactId$BACKUP_EXTENSION"
    val output = File(artifactDirectory, fileName)

    val sources = buildBackupArchiveSources(
      snapshot,
      mediaRoot,
      bubbleSkinRoot,
      settingsBytes,
      excludedMediaPrefixes,
    )
    val manifest = buildManifest(
      artifactId,
      createdAt,
      appVersion,
      databaseContractVersion,
      sources,
    ).toString().toByteArray(Charsets.UTF_8)

    val header = JSONObject()
      .put("formatVersion", 2)
      .put("cipher", "none")
      .toString().toByteArray(Charsets.UTF_8)
    try {
      BackupArchive.write(output, header, manifest, sources)
    } catch (error: Exception) {
      output.delete()
      throw BackupStorageException("创建备份包失败", error)
    }

    return artifactMap(artifactId, fileName, output.length(), Uri.fromFile(output).toString())
  }

  private fun publishToDownloads(sourceLocator: String, fileName: String): Map<String, Any> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val source = requireLocalFile(sourceLocator)
    val artifactDirectory = File(context.cacheDir, "backup-artifacts").canonicalFile
    if (!source.canonicalFile.toPath().startsWith(artifactDirectory.toPath())) {
      throw BackupStorageException("只能发布由备份模块生成的产物")
    }
    if (!source.isFile || fileName != source.name || !fileName.endsWith(BACKUP_EXTENSION)) {
      throw BackupStorageException("备份产物无效")
    }

    val resolver = context.contentResolver
    val values = ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, fileName)
      put(MediaStore.Downloads.MIME_TYPE, BACKUP_MIME_TYPE)
      put(MediaStore.Downloads.RELATIVE_PATH, DOWNLOAD_RELATIVE_PATH)
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    var publishedUri: Uri? = null
    try {
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw BackupStorageException("无法在下载目录创建备份文件")
      publishedUri = uri
      resolver.openOutputStream(uri, "w")?.use { output ->
        FileInputStream(source).use { input -> input.copyTo(output) }
      } ?: throw BackupStorageException("无法写入下载目录中的备份文件")
      val updated = resolver.update(uri, ContentValues().apply {
        put(MediaStore.Downloads.IS_PENDING, 0)
      }, null, null)
      if (updated != 1) throw BackupStorageException("无法完成下载目录备份发布")
      return artifactMap(
        uri.lastPathSegment ?: uri.toString(),
        fileName,
        querySize(uri),
        uri.toString(),
      ) + ("createdAt" to Instant.now().toString())
    } catch (error: Exception) {
      publishedUri?.let { resolver.delete(it, null, null) }
      throw BackupStorageException("发布备份文件失败", error)
    } finally {
      source.delete()
    }
  }

  private fun listPublishedBackups(): List<Map<String, Any>> {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    cleanupStalePendingBackups(context)
    val projection = arrayOf(
      MediaStore.Downloads._ID,
      MediaStore.Downloads.DISPLAY_NAME,
      MediaStore.Downloads.SIZE,
      MediaStore.Downloads.DATE_ADDED,
    )
    val selection = "${MediaStore.Downloads.RELATIVE_PATH} = ? AND " +
      "${MediaStore.Downloads.DISPLAY_NAME} LIKE ? AND ${MediaStore.Downloads.IS_PENDING} = 0"
    val arguments = arrayOf(DOWNLOAD_RELATIVE_PATH, "%$BACKUP_EXTENSION")
    val result = mutableListOf<Map<String, Any>>()

    context.contentResolver.query(
      MediaStore.Downloads.EXTERNAL_CONTENT_URI,
      projection,
      selection,
      arguments,
      "${MediaStore.Downloads.DATE_ADDED} DESC",
    )?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
      val nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DISPLAY_NAME)
      val sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads.SIZE)
      val dateColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads.DATE_ADDED)
      while (cursor.moveToNext()) {
        val id = cursor.getLong(idColumn)
        val uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id.toString())
        result += artifactMap(
          id.toString(),
          cursor.getString(nameColumn),
          cursor.getLong(sizeColumn),
          uri.toString(),
        ) + ("createdAt" to Instant.ofEpochSecond(cursor.getLong(dateColumn)).toString())
      }
    }
    return result
  }

  private fun cleanupStalePendingBackups(context: android.content.Context) {
    val resolver = context.contentResolver
    val cutoffEpochSeconds = Instant.now().epochSecond - STALE_PENDING_AGE_SECONDS
    val projection = arrayOf(MediaStore.Downloads._ID)
    val selection = "${MediaStore.Downloads.RELATIVE_PATH} = ? AND " +
      "${MediaStore.Downloads.OWNER_PACKAGE_NAME} = ? AND " +
      "${MediaStore.Downloads.MIME_TYPE} = ? AND " +
      "${MediaStore.Downloads.DISPLAY_NAME} LIKE ? AND " +
      "${MediaStore.Downloads.IS_PENDING} = 1 AND " +
      "${MediaStore.Downloads.DATE_ADDED} <= ?"
    val arguments = arrayOf(
      DOWNLOAD_RELATIVE_PATH,
      context.packageName,
      BACKUP_MIME_TYPE,
      "$BACKUP_FILE_NAME_PREFIX%$BACKUP_EXTENSION",
      cutoffEpochSeconds.toString(),
    )
    val staleUris = mutableListOf<Uri>()
    resolver.query(
      MediaStore.Downloads.EXTERNAL_CONTENT_URI,
      projection,
      selection,
      arguments,
      "${MediaStore.Downloads.DATE_ADDED} ASC",
    )?.use { cursor ->
      val idColumn = cursor.getColumnIndexOrThrow(MediaStore.Downloads._ID)
      while (cursor.moveToNext() && staleUris.size < STALE_PENDING_CLEANUP_LIMIT) {
        staleUris += Uri.withAppendedPath(
          MediaStore.Downloads.EXTERNAL_CONTENT_URI,
          cursor.getLong(idColumn).toString(),
        )
      }
    }
    staleUris.forEach { resolver.delete(it, null, null) }
  }

  private fun deletePublishedBackup(artifactId: String) {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    val id = artifactId.toLongOrNull() ?: throw BackupStorageException("备份标识无效")
    val uri = Uri.withAppendedPath(MediaStore.Downloads.EXTERNAL_CONTENT_URI, id.toString())
    if (context.contentResolver.delete(uri, null, null) != 1) {
      throw BackupStorageException("没有找到要删除的备份")
    }
  }

  private fun buildBackupArchiveSources(
    snapshot: File,
    mediaRoot: File,
    bubbleSkinRoot: File,
    settingsBytes: ByteArray,
    excludedMediaPrefixes: List<String>,
  ): List<BackupArchiveSource> {
    val result = mutableListOf(
      fileSource("database/raven.db", snapshot),
      bytesSource("settings/stable-settings.json", settingsBytes),
    )
    result += directorySources("media/persistent-media", mediaRoot, excludedMediaPrefixes)
    result += directorySources("files/ravencat/bubble-skins", bubbleSkinRoot)
    return result
  }

  private fun directorySources(archiveRoot: String, directory: File, excludedPrefixes: List<String> = emptyList()): List<BackupArchiveSource> {
    if (!directory.isDirectory) return emptyList()
    return backupMediaFiles(directory, excludedPrefixes).asSequence()
      .map { file ->
        val relativePath = file.relativeTo(directory).invariantSeparatorsPath
        fileSource("$archiveRoot/$relativePath", file)
      }
      .toList()
  }

  private fun buildManifest(
    artifactId: String,
    createdAt: String,
    appVersion: String,
    databaseContractVersion: Int,
    sources: List<BackupArchiveSource>,
  ): JSONObject {
    val entries = JSONArray()
    sources.forEach { source ->
      entries.put(JSONObject()
        .put("path", source.archivePath)
        .put("byteLength", source.byteLength))
    }
    return JSONObject()
      .put("backupFormatVersion", 2)
      .put("artifactId", artifactId)
      .put("createdAt", createdAt)
      .put("appVersion", appVersion)
      .put("databaseContractVersion", databaseContractVersion)
      .put("sourcePlatform", "android")
      .put("sourceAndroidApi", Build.VERSION.SDK_INT)
      .put("entries", entries)
  }

  private fun fileSource(path: String, file: File): BackupArchiveSource = BackupArchiveSource(
    archivePath = path,
    file = file,
    bytes = null,
    byteLength = file.length(),
  )

  private fun bytesSource(path: String, bytes: ByteArray): BackupArchiveSource = BackupArchiveSource(
    archivePath = path,
    file = null,
    bytes = bytes,
    byteLength = bytes.size.toLong(),
  )

  private fun querySize(uri: Uri): Long {
    val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
    return context.contentResolver.query(
      uri,
      arrayOf(MediaStore.Downloads.SIZE),
      null,
      null,
      null,
    )?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getLong(0) else 0L
    } ?: 0L
  }

  private fun requireString(options: Map<String, Any?>, key: String): String {
    return (options[key] as? String)?.takeIf(String::isNotBlank)
      ?: throw BackupStorageException("缺少参数：$key")
  }

  private fun requireLocalFile(locator: String, allowMissing: Boolean = false): File {
    val uri = Uri.parse(locator)
    if (uri.scheme != "file") {
      throw BackupStorageException("只接受应用内部文件 URI")
    }
    val file = File(uri.path ?: throw BackupStorageException("文件 URI 无效"))
    if (!allowMissing && !file.exists()) {
      throw BackupStorageException("文件不存在")
    }
    return file
  }

  private fun artifactMap(
    artifactId: String,
    fileName: String,
    byteLength: Long,
    locator: String,
  ): Map<String, Any> = mapOf(
    "artifactId" to artifactId,
    "fileName" to fileName,
    "byteLength" to byteLength.toDouble(),
    "locator" to locator,
  )
}
