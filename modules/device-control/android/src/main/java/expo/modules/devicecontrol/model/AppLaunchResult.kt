package expo.modules.devicecontrol.model

/**
 * openApp 的 typed 原生结果。
 *
 * LAUNCH_DISPATCHED 只代表 RavenCat 已把目标 package 的 front-door 启动请求
 * 交给 Android，不代表目标 App 已经进入前台；执行请求与设备事实必须分离。
 */
enum class AppLaunchStatus(val serial: String) {
  LAUNCH_DISPATCHED("launch_dispatched"),
  APP_NOT_LAUNCHABLE("app_not_launchable"),
  LAUNCH_FAILED("launch_failed"),
}

data class AppLaunchResult(
  val status: AppLaunchStatus,
  val packageName: String,
  val reason: String? = null,
) {
  fun toMap(): Map<String, Any?> {
    return mapOf(
      "status" to status.serial,
      "packageName" to packageName,
      "reason" to reason,
    )
  }

  companion object {
    fun launchDispatched(packageName: String): AppLaunchResult =
      AppLaunchResult(AppLaunchStatus.LAUNCH_DISPATCHED, packageName)

    /**
     * front-door 启动入口当前无法执行（dispatch 抛 SendIntentException）。
     * 该异常也覆盖 IntentSender 被取消 / 已无法执行的情况，不等于“package 一定未安装”。
     */
    fun appNotLaunchable(packageName: String): AppLaunchResult =
      AppLaunchResult(
        AppLaunchStatus.APP_NOT_LAUNCHABLE,
        packageName,
        reason = "目标应用没有可执行的前台启动入口",
      )

    /** 不预期的原生执行失败；不携带 stack trace / Intent 内部 / 组件转储。 */
    fun launchFailed(packageName: String): AppLaunchResult =
      AppLaunchResult(
        AppLaunchStatus.LAUNCH_FAILED,
        packageName,
        reason = "应用启动请求派发失败",
      )
  }
}
