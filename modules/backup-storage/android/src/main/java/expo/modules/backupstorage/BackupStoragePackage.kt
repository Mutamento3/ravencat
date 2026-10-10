package expo.modules.backupstorage

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** 通过 Expo 自动链接注册冷启动恢复，不依赖会被 prebuild 重建的主工程文件。 */
class BackupStoragePackage : Package {
  override fun createApplicationLifecycleListeners(
    context: Context,
  ): List<ApplicationLifecycleListener> = listOf(BackupRestoreLifecycleListener())
}

private class BackupRestoreLifecycleListener : ApplicationLifecycleListener {
  override fun onCreate(application: Application) {
    BackupRestoreBootstrap.activatePendingRestore(application)
  }
}
