package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.MediaSessionTransportCommand
import expo.modules.devicecontrol.model.MediaSessionTransportResult

/**
 * exact-package MediaSession transport command 的唯一执行入口。
 *
 * 固定顺序：
 * command 解析 → exact package 校验 → Notification Listener 授权 → exact session 解析
 * → advertised action admission → TransportControls 单次调用。
 *
 * 硬性边界：
 * - 当前 playback state 不参与 admission，也不参与业务拒绝；能力真值只来自 advertised actions；
 * - 调用后不 sleep、不 poll、不重新读取 playback state 验证结果；
 * - 没有 active session 时不开 App、不 deep link、不选其他媒体 App、不退回 global media key；
 * - 与 Soft Lock / DeviceControlService 生命周期无关，可在 runtime 未启动时工作。
 */
internal class MediaSessionTransportController(
  private val loadControllers: () -> List<MediaSessionControllerSource>,
  private val accessReader: NotificationListenerAccessReader,
) {
  fun dispatch(rawPackageName: String, rawCommand: String): MediaSessionTransportResult {
    val command = MediaSessionTransportCommand.fromWireName(rawCommand)
      ?: return MediaSessionTransportResult.InvalidCommand("command 必须是 pause / resume / next / previous 之一")

    val packageName = rawPackageName.trim()
    if (!isValidExactPackageName(packageName)) {
      return MediaSessionTransportResult.InvalidPackageName("packageName 必须是单个 exact package")
    }
    if (!accessReader.isGranted()) {
      return MediaSessionTransportResult.PermissionNotGranted
    }

    return try {
      val source = ExactPackageMediaSessionResolver().resolve(packageName, loadControllers())
        ?: return MediaSessionTransportResult.NoActiveSession(packageName)
      if (source.actions() and command.actionBit == 0L) {
        return MediaSessionTransportResult.ActionNotSupported(packageName, command)
      }
      source.dispatch(command)
      MediaSessionTransportResult.CommandDispatched(packageName, command)
    } catch (error: Exception) {
      MediaSessionTransportResult.DispatchFailed(
        packageName,
        command,
        error.message ?: error.javaClass.simpleName,
      )
    }
  }
}
