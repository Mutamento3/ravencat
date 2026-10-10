package expo.modules.devicecontrol.controller

import android.content.Context
import android.content.IntentSender
import expo.modules.devicecontrol.model.AppLaunchResult

/**
 * 只处理一个 exact Android package 的 front-door launch 请求。
 *
 * 边界：
 * - 不做 Launcher 目录枚举，也不构造深链接、URI、intent extras 或任意 Intent；
 * - 不知道受保护应用集合或用户策略（属于 product 层）；
 * - 不重试、不轮询、不读取当前前台状态；
 * - 不声明目标 App 已经进入前台——dispatch 正常返回只代表启动请求已交给 Android。
 *
 * 失败映射（按 Android 官方 contract）：
 * - getLaunchIntentSenderForPackage 对未知 package / 无 front-door activity 不会同步
 *   返回 null，失败在 dispatch 时以 SendIntentException 暴露 → app_not_launchable
 *   （含 IntentSender 被取消 / 已无法执行的情况，不等于“package 一定未安装”）；
 * - SecurityException 与其他执行异常属于真正的 native execution failure → launch_failed。
 */
internal class AppLauncher(private val context: Context) {
  fun openApp(packageName: String): AppLaunchResult {
    // getLaunchIntentSenderForPackage 是 API 33 提供的 package front-door 启动 API：
    // exact package 输入，不需要手拼 Activity component，也不依赖 package visibility。
    val launchSender = try {
      context.packageManager.getLaunchIntentSenderForPackage(packageName)
    } catch (_: SecurityException) {
      return AppLaunchResult.launchFailed(packageName)
    }

    return try {
      launchSender.sendIntent(context, 0, null, null, null, null)
      AppLaunchResult.launchDispatched(packageName)
    } catch (_: IntentSender.SendIntentException) {
      AppLaunchResult.appNotLaunchable(packageName)
    } catch (_: SecurityException) {
      AppLaunchResult.launchFailed(packageName)
    }
  }
}
