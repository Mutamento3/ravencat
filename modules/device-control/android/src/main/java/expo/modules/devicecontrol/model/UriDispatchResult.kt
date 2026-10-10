package expo.modules.devicecontrol.model

/**
 * dispatchBrowsableUri 的 typed 原生结果。
 *
 * URI_DISPATCHED 只代表 RavenCat 已把 exact package 的 VIEW 请求交给 Android，
 * 不代表目标页面已经打开、不代表任何业务结果（例如音乐已开始播放）；
 * 执行请求与设备事实必须分离，最终状态只能由新的设备事实表达。
 *
 * 结果不回传完整 URI：bridge 只上报 status、被执行的 exact package 与 reason。
 */
enum class UriDispatchStatus(val serial: String) {
  URI_DISPATCHED("uri_dispatched"),
  ROUTE_UNAVAILABLE("route_unavailable"),
  ROUTE_DISPATCH_FAILED("route_dispatch_failed"),
}

data class UriDispatchResult(
  val status: UriDispatchStatus,
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
    fun uriDispatched(packageName: String): UriDispatchResult =
      UriDispatchResult(UriDispatchStatus.URI_DISPATCHED, packageName)

    /**
     * 目标 package 当前没有可接受该 URI 的 exported browsable route。
     * 这不断言目标 package 一定未安装，只表达这次 route 派发没有可执行入口。
     */
    fun routeUnavailable(packageName: String): UriDispatchResult =
      UriDispatchResult(
        UriDispatchStatus.ROUTE_UNAVAILABLE,
        packageName,
        reason = "目标应用当前没有可接受该 URI 的入口",
      )

    /** 真正的原生执行失败；不携带 stack trace、Intent 内部或 URI 回传。 */
    fun routeDispatchFailed(packageName: String): UriDispatchResult =
      UriDispatchResult(
        UriDispatchStatus.ROUTE_DISPATCH_FAILED,
        packageName,
        reason = "URI 派发请求执行失败",
      )
  }
}
