package expo.modules.backupstorage

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import java.io.File
import java.io.FileOutputStream

internal data class PendingRestoreAction(
  val kind: String,
  val stableSettingsJson: String,
  val failureMessage: String? = null,
)

object BackupRestoreBootstrap {
  private const val preferencesName = "ravencat_backup_restore"
  private const val phaseKey = "phase"
  private const val restoreIdKey = "restoreId"
  private const val rollbackReasonKey = "rollbackReason"
  private const val lastErrorKey = "lastError"
  private const val hadDatabaseKey = "hadDatabase"
  private const val hadDatabaseWalKey = "hadDatabaseWal"
  private const val hadDatabaseShmKey = "hadDatabaseShm"
  private const val hadMediaKey = "hadMedia"
  private const val hadBubbleSkinsKey = "hadBubbleSkins"

  private const val phasePrepared = "prepared"
  private const val phaseApplying = "applying"
  private const val phaseActivated = "activated"
  private const val phaseRollingBack = "rolling_back"
  private const val phaseRollbackSettings = "rollback_settings"
  private const val phaseCommitted = "committed"
  private const val phaseRolledBack = "rolled_back"

  private const val applySettingsAction = "apply_settings"
  private const val restoreRollbackSettingsAction = "restore_rollback_settings"

  @JvmStatic
  fun activatePendingRestore(context: Context) {
    val preferences = preferences(context)
    val restoreId = preferences.getString(restoreIdKey, null) ?: return
    try {
      when (preferences.getString(phaseKey, null)) {
        phasePrepared -> applyPreparedRestore(context, restoreId)
        phaseApplying -> beginRollback(
          context,
          restoreId,
          "上次恢复在替换数据时中断，原数据已回滚",
        )
        phaseActivated -> beginRollback(
          context,
          restoreId,
          "上次恢复在正式提交前中断，原数据已回滚",
        )
        phaseRollingBack -> continueRollback(context, restoreId)
        phaseCommitted, phaseRolledBack -> collectGarbage(context)
      }
    } catch (error: Exception) {
      // journal 保留最后一个持久 phase；下次冷启动从该 phase 重入。
      Log.e("BackupRestore", "冷启动恢复事务未完成，将在下次启动继续", error)
    }
  }

  internal fun schedule(
    context: Context,
    restoreId: String,
    rollbackStableSettingsJson: String,
  ) {
    val staging = stagingDirectory(context, restoreId)
    if (!File(staging, "database/raven.db").isFile ||
      !File(staging, "settings/stable-settings.json").isFile) {
      throw IllegalArgumentException("待恢复内容不完整")
    }

    val preferences = preferences(context)
    check(preferences.getString(phaseKey, null) == null) { "已有恢复事务尚未收口" }
    val rollbackSettings = rollbackSettingsFile(context, restoreId)
    writeDurableText(rollbackSettings, rollbackStableSettingsJson)
    try {
      check(preferences.edit()
        .putString(restoreIdKey, restoreId)
        .putString(phaseKey, phasePrepared)
        .remove(lastErrorKey)
        .commit()) { "无法登记待恢复任务" }
    } catch (error: Exception) {
      rollbackDirectory(context, restoreId).deleteRecursively()
      throw error
    }
  }

  internal fun readPendingAction(context: Context): PendingRestoreAction? {
    val preferences = preferences(context)
    val restoreId = preferences.getString(restoreIdKey, null) ?: return null
    return when (preferences.getString(phaseKey, null)) {
      phaseActivated -> PendingRestoreAction(
        kind = applySettingsAction,
        stableSettingsJson = File(
          stagingDirectory(context, restoreId),
          "settings/stable-settings.json",
        ).readText(Charsets.UTF_8),
      )
      phaseRollbackSettings -> PendingRestoreAction(
        kind = restoreRollbackSettingsAction,
        stableSettingsJson = rollbackSettingsFile(context, restoreId).readText(Charsets.UTF_8),
        failureMessage = requireRollbackReason(preferences),
      )
      phaseCommitted, phaseRolledBack -> null
      else -> throw IllegalStateException("原生恢复事务尚未完成文件阶段")
    }
  }

  internal fun commitActivatedRestore(context: Context) {
    val preferences = preferences(context)
    check(preferences.getString(phaseKey, null) == phaseActivated) {
      "当前恢复事务不能提交"
    }
    check(preferences.edit().putString(phaseKey, phaseCommitted).commit()) {
      "无法提交恢复事务"
    }
  }

  internal fun rollbackActivatedRestore(context: Context, failureMessage: String) {
    val preferences = preferences(context)
    val restoreId = preferences.getString(restoreIdKey, null)
      ?: throw IllegalStateException("恢复事务标识不存在")
    check(preferences.getString(phaseKey, null) == phaseActivated) {
      "当前恢复事务不能回滚"
    }
    beginRollback(context, restoreId, failureMessage)
  }

  internal fun completeRolledBackRestore(context: Context) {
    val preferences = preferences(context)
    check(preferences.getString(phaseKey, null) == phaseRollbackSettings) {
      "恢复事务尚未完成稳定设置回滚"
    }
    check(preferences.edit().putString(phaseKey, phaseRolledBack).commit()) {
      "无法确认恢复事务已回滚"
    }
  }

  internal fun collectGarbage(context: Context) {
    val preferences = preferences(context)
    val phase = preferences.getString(phaseKey, null) ?: return
    if (phase != phaseCommitted && phase != phaseRolledBack) return
    val restoreId = preferences.getString(restoreIdKey, null)
      ?: throw IllegalStateException("恢复事务标识不存在")
    check(stagingDirectory(context, restoreId).deleteRecursively()) {
      "无法清理恢复 staging"
    }
    check(rollbackDirectory(context, restoreId).deleteRecursively()) {
      "无法清理恢复回滚数据"
    }

    val editor = preferences.edit()
      .remove(phaseKey)
      .remove(restoreIdKey)
      .remove(rollbackReasonKey)
      .remove(hadDatabaseKey)
      .remove(hadDatabaseWalKey)
      .remove(hadDatabaseShmKey)
      .remove(hadMediaKey)
      .remove(hadBubbleSkinsKey)
    if (phase == phaseRolledBack) {
      editor.putString(lastErrorKey, requireRollbackReason(preferences))
    }
    check(editor.commit()) { "无法完成恢复事务清理" }
  }

  internal fun consumeRestoreFailure(context: Context): String? {
    val preferences = preferences(context)
    val message = preferences.getString(lastErrorKey, null) ?: return null
    check(preferences.edit().remove(lastErrorKey).commit()) { "无法确认恢复失败消息" }
    return message
  }

  internal fun discard(context: Context, restoreId: String) {
    val preferences = preferences(context)
    if (preferences.getString(restoreIdKey, null) == restoreId) {
      throw IllegalStateException("已登记的恢复事务不能作为 staging 丢弃")
    }
    check(stagingDirectory(context, restoreId).deleteRecursively()) { "无法清理待恢复数据" }
    rollbackDirectory(context, restoreId).deleteRecursively()
  }

  private fun applyPreparedRestore(context: Context, restoreId: String) {
    val preferences = preferences(context)
    val staging = stagingDirectory(context, restoreId)
    val rollback = rollbackDirectory(context, restoreId).apply { mkdirs() }
    val databaseTarget = databaseTarget(context)
    val mediaTarget = mediaTarget(context)
    val bubbleSkinTarget = bubbleSkinTarget(context)
    check(preferences.edit()
      .putString(phaseKey, phaseApplying)
      .putBoolean(hadDatabaseKey, databaseTarget.exists())
      .putBoolean(hadDatabaseWalKey, File(databaseTarget.path + "-wal").exists())
      .putBoolean(hadDatabaseShmKey, File(databaseTarget.path + "-shm").exists())
      .putBoolean(hadMediaKey, mediaTarget.exists())
      .putBoolean(hadBubbleSkinsKey, bubbleSkinTarget.exists())
      .commit()) { "无法登记恢复事务" }

    try {
      moveIfPresent(databaseTarget, File(rollback, "database.db"))
      moveIfPresent(File(databaseTarget.path + "-wal"), File(rollback, "database.db-wal"))
      moveIfPresent(File(databaseTarget.path + "-shm"), File(rollback, "database.db-shm"))
      moveIfPresent(mediaTarget, File(rollback, "persistent-media"))
      moveIfPresent(bubbleSkinTarget, File(rollback, "bubble-skins"))

      databaseTarget.parentFile?.mkdirs()
      val databaseTemp = databaseRestoreTemp(context)
      File(staging, "database/raven.db").copyTo(databaseTemp, overwrite = true)
      if (!databaseTemp.renameTo(databaseTarget)) throw IllegalStateException("无法激活恢复数据库")

      val stagedMedia = File(staging, "media/persistent-media")
      if (stagedMedia.exists()) {
        if (!stagedMedia.renameTo(mediaTarget)) throw IllegalStateException("无法激活恢复媒体")
      } else {
        mediaTarget.mkdirs()
      }
      activateDirectory(File(staging, "files/ravencat/bubble-skins"), bubbleSkinTarget)

      check(preferences.edit().putString(phaseKey, phaseActivated).commit()) {
        "无法确认恢复已激活"
      }
    } catch (error: Exception) {
      beginRollback(context, restoreId, error.message ?: "激活恢复数据失败")
      throw error
    }
  }

  private fun beginRollback(context: Context, restoreId: String, failureMessage: String) {
    val preferences = preferences(context)
    check(preferences.edit()
      .putString(phaseKey, phaseRollingBack)
      .putString(rollbackReasonKey, failureMessage)
      .commit()) { "无法登记恢复回滚" }
    continueRollback(context, restoreId)
  }

  private fun continueRollback(context: Context, restoreId: String) {
    rollbackData(context, restoreId)
    check(preferences(context).edit().putString(phaseKey, phaseRollbackSettings).commit()) {
      "无法确认数据文件已回滚"
    }
  }

  private fun rollbackData(context: Context, restoreId: String) {
    val preferences = preferences(context)
    val rollback = rollbackDirectory(context, restoreId)
    val databaseTarget = databaseTarget(context)
    databaseRestoreTemp(context).delete()
    rollbackFileTarget(
      preferences.getBoolean(hadDatabaseKey, false),
      File(rollback, "database.db"),
      databaseTarget,
    )
    rollbackFileTarget(
      preferences.getBoolean(hadDatabaseWalKey, false),
      File(rollback, "database.db-wal"),
      File(databaseTarget.path + "-wal"),
    )
    rollbackFileTarget(
      preferences.getBoolean(hadDatabaseShmKey, false),
      File(rollback, "database.db-shm"),
      File(databaseTarget.path + "-shm"),
    )

    rollbackDirectoryTarget(
      preferences.getBoolean(hadMediaKey, false),
      File(rollback, "persistent-media"),
      mediaTarget(context),
    )
    rollbackDirectoryTarget(
      preferences.getBoolean(hadBubbleSkinsKey, false),
      File(rollback, "bubble-skins"),
      bubbleSkinTarget(context),
    )
  }

  private fun activateDirectory(staged: File, target: File) {
    if (staged.exists()) {
      target.parentFile?.mkdirs()
      if (!staged.renameTo(target)) throw IllegalStateException("无法激活恢复目录：${target.name}")
    } else {
      target.mkdirs()
    }
  }

  private fun rollbackDirectoryTarget(hadTarget: Boolean, backup: File, target: File) {
    if (hadTarget) {
      if (backup.exists()) {
        target.deleteRecursively()
        moveIfPresent(backup, target)
      }
    } else {
      target.deleteRecursively()
    }
  }

  private fun rollbackFileTarget(hadTarget: Boolean, backup: File, target: File) {
    if (hadTarget) {
      if (backup.exists()) {
        target.delete()
        moveIfPresent(backup, target)
      }
    } else {
      target.delete()
    }
  }

  private fun moveIfPresent(source: File, target: File) {
    if (!source.exists()) return
    target.parentFile?.mkdirs()
    if (!source.renameTo(target)) throw IllegalStateException("无法移动恢复文件：${source.name}")
  }

  private fun writeDurableText(target: File, value: String) {
    target.parentFile?.mkdirs()
    FileOutputStream(target).use { output ->
      output.write(value.toByteArray(Charsets.UTF_8))
      output.fd.sync()
    }
  }

  private fun requireRollbackReason(preferences: SharedPreferences): String =
    preferences.getString(rollbackReasonKey, null)
      ?: throw IllegalStateException("恢复回滚原因不存在")

  private fun preferences(context: Context) =
    context.getSharedPreferences(preferencesName, Context.MODE_PRIVATE)

  private fun databaseTarget(context: Context) = File(context.filesDir, "SQLite/kimiphone_v5.db")
  private fun databaseRestoreTemp(context: Context) =
    File(context.filesDir, "SQLite/kimiphone_v5.db.restore")
  private fun mediaTarget(context: Context) = File(context.filesDir, "persistent-media")
  private fun bubbleSkinTarget(context: Context) = File(context.filesDir, "ravencat/bubble-skins")
  private fun rollbackSettingsFile(context: Context, restoreId: String) =
    File(rollbackDirectory(context, restoreId), "settings/stable-settings.json")
  private fun stagingDirectory(context: Context, restoreId: String) =
    File(context.filesDir, "backup-restore-staging/$restoreId")
  private fun rollbackDirectory(context: Context, restoreId: String) =
    File(context.filesDir, "backup-restore-rollback/$restoreId")
}
