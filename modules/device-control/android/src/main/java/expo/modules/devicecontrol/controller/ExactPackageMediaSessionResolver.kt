package expo.modules.devicecontrol.controller

import expo.modules.devicecontrol.model.MediaSessionSnapshot
import expo.modules.devicecontrol.model.MediaSessionTransportCommand

internal const val MAX_MEDIA_SESSION_PACKAGE_NAME_LENGTH = 255

/**
 * 一个 exact package 的 MediaSession handle。
 *
 * 同一份 handle 同时提供 observation 与 command 能力：这不是把读写语义混在一起，
 * 而是让 observation selection 与 command selection 无法漂移——两者解析到的必然是
 * 同一个 session identity。外部不得绕过 resolver 自行挑 controller。
 */
internal interface MediaSessionControllerSource {
  val packageName: String
  fun snapshot(): MediaSessionSnapshot
  /** 当前 PlaybackState.actions bitmask；command admission 的唯一能力真值。 */
  fun actions(): Long
  fun dispatch(command: MediaSessionTransportCommand)
}

/**
 * observation 与 command 共用的 exact-package session selection truth。
 *
 * 只接受完全相等的 packageName：不做 first()、不做模糊匹配、不做大小写改写、
 * 不挑选“当前最活跃的媒体应用”。
 */
internal class ExactPackageMediaSessionResolver {
  fun resolve(
    packageName: String,
    sources: List<MediaSessionControllerSource>,
  ): MediaSessionControllerSource? = sources.firstOrNull { it.packageName == packageName }
}

/** exact package 校验的唯一入口：blank、空白、wildcard、逗号列表、超长一律拒绝。 */
internal fun isValidExactPackageName(packageName: String): Boolean =
  packageName.isNotEmpty() &&
    packageName.length <= MAX_MEDIA_SESSION_PACKAGE_NAME_LENGTH &&
    !packageName.contains('*') &&
    !packageName.contains(',') &&
    !packageName.any(Char::isWhitespace)
