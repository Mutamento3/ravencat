package expo.modules.devicecontrol.model

import android.media.session.PlaybackState

/**
 * exact-package MediaSession transport command。
 *
 * 第一版只有四个离散 command，且刻意不暴露 "play"：
 * - resume 语义是“恢复当前 session”，对应 TransportControls.play()；
 * - 它不代表“播放指定歌曲”，后台精确选歌不属于本 primitive。
 *
 * 每个 command 绑定唯一一个 advertised action bit：admission 按具体 bit 判断，
 * ACTION_PLAY_PAUSE 不能替代 ACTION_PLAY / ACTION_PAUSE。
 */
enum class MediaSessionTransportCommand(
  val wireName: String,
  val actionBit: Long,
) {
  PAUSE("pause", PlaybackState.ACTION_PAUSE),
  RESUME("resume", PlaybackState.ACTION_PLAY),
  NEXT("next", PlaybackState.ACTION_SKIP_TO_NEXT),
  PREVIOUS("previous", PlaybackState.ACTION_SKIP_TO_PREVIOUS),
  ;

  companion object {
    /** 未知 command 返回 null，由调用方表达 typed failure；不 silent fallback。 */
    fun fromWireName(value: String): MediaSessionTransportCommand? =
      entries.firstOrNull { it.wireName == value }
  }
}

/**
 * exact-package transport dispatch 的 typed 结果。
 *
 * COMMAND_DISPATCHED 只代表请求已交给目标 session，不代表 playback state 已经改变；
 * 最终事实必须由一次新的 getMediaSessionSnapshot 独立观察。
 * NO_ACTIVE_SESSION 不代表目标 App 未安装，只代表当前没有该 package 的 active session。
 */
sealed interface MediaSessionTransportResult {
  fun toMap(): Map<String, Any?>

  data class CommandDispatched(
    val packageName: String,
    val command: MediaSessionTransportCommand,
  ) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "command_dispatched",
      "packageName" to packageName,
      "command" to command.wireName,
    )
  }

  data object PermissionNotGranted : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf("status" to "permission_not_granted")
  }

  data class NoActiveSession(val packageName: String) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "no_active_session",
      "packageName" to packageName,
    )
  }

  /** 目标 session 没有 advertise 该 command 对应的 action bit；transport 调用次数为 0。 */
  data class ActionNotSupported(
    val packageName: String,
    val command: MediaSessionTransportCommand,
  ) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "action_not_supported",
      "packageName" to packageName,
      "command" to command.wireName,
    )
  }

  data class InvalidPackageName(val reason: String) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "invalid_package_name",
      "reason" to reason,
    )
  }

  /** bridge 边界校验：未知 command 一律拒绝，不猜测、不映射成默认动作。 */
  data class InvalidCommand(val reason: String) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "invalid_command",
      "reason" to reason,
    )
  }

  /** 真正的原生执行失败（含 discovery 时被系统撤销授权）；不伪装成 no_active_session。 */
  data class DispatchFailed(
    val packageName: String,
    val command: MediaSessionTransportCommand,
    val reason: String,
  ) : MediaSessionTransportResult {
    override fun toMap(): Map<String, Any?> = mapOf(
      "status" to "dispatch_failed",
      "packageName" to packageName,
      "command" to command.wireName,
      "reason" to reason,
    )
  }
}
