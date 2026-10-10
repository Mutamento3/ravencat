package expo.modules.devicecontrol.controller

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import expo.modules.devicecontrol.model.UriDispatchResult

/**
 * 只处理「exact Android package + 单个 browsable URI」的 Android ACTION_VIEW 派发。
 *
 * 这不是 arbitrary Intent API：
 * - 只接受一个 URI 字符串，不接受 action / component / activity class / flags / extras /
 *   ClipData / MIME type / grant flags / chooser / broadcast / service / PendingIntent；
 * - 目标锁定 exact package。目标包失败后不删除 setPackage、不让系统其他 App 接管，无 hidden fallback；
 * - 使用 CATEGORY_BROWSABLE 保持「外部可浏览 URI route」语义，避免命中目标 App 的内部非导出入口；
 * - 从 application context 启动，因此固定 FLAG_ACTIVITY_NEW_TASK。
 *
 * 边界：不知道受保护应用集合或用户策略（属于 product 层）；不重试、不轮询、不读取前台状态；
 * 不枚举 PackageManager 目录，不请求 package visibility。
 *
 * 失败映射（按 Android 官方 contract）：
 * - ActivityNotFoundException：目标 package 当前没有可接受该 URI 的 exported route
 *   （也覆盖 package 未安装的情况，因此 result 不断言“一定未安装”）→ route_unavailable；
 * - SecurityException：真正的执行拒绝 → route_dispatch_failed。
 * 其他非预期异常按真实失败直接抛出，不静默改写成成功。
 */
internal class BrowsableUriDispatcher(private val context: Context) {
  fun dispatch(packageName: String, uri: String): UriDispatchResult {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(uri)).apply {
      setPackage(packageName)
      addCategory(Intent.CATEGORY_BROWSABLE)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    return try {
      context.startActivity(intent)
      UriDispatchResult.uriDispatched(packageName)
    } catch (_: ActivityNotFoundException) {
      UriDispatchResult.routeUnavailable(packageName)
    } catch (_: SecurityException) {
      UriDispatchResult.routeDispatchFailed(packageName)
    }
  }
}
