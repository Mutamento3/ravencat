package expo.modules.deviceobserver

import android.accessibilityservice.AccessibilityServiceInfo
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.view.accessibility.AccessibilityManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private class OpenAccessibilitySettingsException(cause: Exception) :
  CodedException("无法打开 Android 无障碍设置", cause)

/** Expo 模块桥只暴露设备观察技术状态，不参与 RavenCat 业务决策。 */
class DeviceObserverModule : Module() {
  private var connectionSubscription: DeviceWindowObservationSubscription? = null
  private var windowSubscription: DeviceWindowObservationSubscription? = null

  override fun definition() = ModuleDefinition {
    Name("KimiPhoneDeviceObserver")
    Events("onConnectionStateChanged", "onWindowStateChanged")

    // 读取当前安装包的事实，避免 Metro 配置或云端构建编号与手机实际版本不一致。
    Function("getInstalledApplicationInfo") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val manager = context.packageManager
      val info = manager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0L))
      mapOf(
        "name" to context.applicationInfo.loadLabel(manager).toString(),
        "version" to requireNotNull(info.versionName) { "安装包缺少版本名称" },
        "buildNumber" to info.longVersionCode.toString(),
      )
    }

    OnCreate {
      connectionSubscription = DeviceWindowObservationSource.subscribeConnection {
        val context = appContext.reactContext ?: return@subscribeConnection
        sendEvent("onConnectionStateChanged", getConnectionState(context))
      }
      windowSubscription = DeviceWindowObservationSource.subscribeWindow { state ->
        sendEvent("onWindowStateChanged", state.toMap())
      }
    }

    OnDestroy {
      windowSubscription?.cancel()
      windowSubscription = null
      connectionSubscription?.cancel()
      connectionSubscription = null
    }

    AsyncFunction("openAccessibilitySettings") {
      val activity = appContext.throwingActivity
      val accessibilityIntent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
      val appDetailsIntent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:${activity.packageName}"),
      )

      try {
        activity.startActivity(accessibilityIntent)
      } catch (accessibilityError: Exception) {
        try {
          activity.startActivity(appDetailsIntent)
        } catch (appDetailsError: Exception) {
          throw OpenAccessibilitySettingsException(appDetailsError)
        }
      }
      null
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("getConnectionState") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      getConnectionState(context)
    }

    AsyncFunction("getCurrentWindowState") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      DeviceObserverAccessibilityService.currentWindowState(context).toMap()
    }

    AsyncFunction("getInstalledLaunchableApps") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      InstalledLaunchableAppQuery(context).query()
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("getBatterySnapshot") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      DeviceBatteryQuery(context).read()
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("getLocationAccessState") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      DeviceLocationQuery(context).accessState()
    }

    AsyncFunction("getCurrentLocation") Coroutine { ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      DeviceLocationQuery(context).read()
    }

    AsyncFunction("openLocationSettings") {
      appContext.throwingActivity.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
      null
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("isUsageAccessGranted") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      AppUsageQuery(context).isAccessGranted()
    }

    AsyncFunction("openUsageAccessSettings") {
      appContext.throwingActivity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
      null
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("queryAppUsage") { beginTime: Double, endTime: Double ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      AppUsageQuery(context).query(beginTime.toLong(), endTime.toLong())
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("clearInstalledAppIconCache") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      InstalledLaunchableAppQuery(context).clearIconCache()
      null
    }.runOnQueue(Queues.DEFAULT)

    AsyncFunction("captureScreenshot") Coroutine { payload: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (!isAccessibilityEnabled(context)) {
        throw DeviceScreenshotException(
          "accessibility_disabled",
          "请先在 Android 设置中启用 RavenCat 设备观察",
        )
      }

      val service = DeviceObserverAccessibilityService.connectedInstance()
        ?: throw DeviceScreenshotException(
          "accessibility_disconnected",
          "设备观察无障碍服务当前未连接",
        )
      val requestId = (payload["requestId"] as? String)?.trim().orEmpty()
      if (requestId.isEmpty()) {
        throw DeviceScreenshotException(
          "capture_failed",
          "设备观察截屏 requestId 不能为空",
        )
      }

      val target = payload["target"] as? String ?: "current_window"
      if (target != "current_window" && target != "default_display") {
        throw DeviceScreenshotException(
          "capture_failed",
          "未知的设备观察截屏目标：$target",
        )
      }

      val expectedWindow = if (target == "current_window") {
        parseExpectedWindowIdentity(payload["expectedWindow"])
      } else {
        null
      }
      val (captured, source, windowState) = withContext(Dispatchers.Main) {
        val captureStarted = service.snapshotCurrentWindowWithRevision()
        if (expectedWindow != null) {
          DeviceScreenshotWindowFence.assertCaptureStart(expectedWindow, captureStarted)
        }
        val captureWindowState = captureStarted.windowState ?: DeviceWindowState.unknown()
        val result = service.captureScreenshot(target, captureWindowState)
        if (expectedWindow == null) {
          return@withContext Triple(result.first, result.second, captureWindowState)
        }
        val accepted = DeviceScreenshotWindowFence.acceptCaptured(
          expected = expectedWindow,
          started = captureStarted,
          completed = service.snapshotCurrentWindowWithRevision(),
          captured = result,
          discard = { rejected -> rejected.first.bitmap.recycle() },
        )
        Triple(accepted.first, accepted.second, captureWindowState)
      }
      withContext(Dispatchers.IO) {
        AccessibilityScreenshotWriter(context).write(
          requestId = requestId,
          captured = captured,
          windowState = windowState,
          source = source,
        ).toMap()
      }
    }

    AsyncFunction("readSemanticSnapshot") Coroutine { payload: Map<String, Any?> ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (!isAccessibilityEnabled(context)) {
        throw DeviceSemanticReadException(
          "accessibility_disabled",
          "请先在 Android 设置中启用 RavenCat 设备观察",
        )
      }
      val service = DeviceObserverAccessibilityService.connectedInstance()
        ?: throw DeviceSemanticReadException(
          "accessibility_disconnected",
          "设备观察无障碍服务当前未连接",
        )
      val expectedWindow = parseExpectedSemanticWindowIdentity(payload["expectedWindow"])
      withContext(Dispatchers.Main) {
        service.readSemanticSnapshot(expectedWindow).toMap()
      }
    }

    /**
     * 只接受已经冻结的设备观察截图；OCR 不参与截图、窗口识别或受保护应用策略。
     */
    AsyncFunction("recognizeScreenshotText") Coroutine { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        ManagedScreenshotTextRecognizer(context).recognize(uri).toMap()
      }
    }

    AsyncFunction("deleteScreenshot") Coroutine { uri: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      withContext(Dispatchers.IO) {
        AccessibilityScreenshotWriter(context).delete(uri)
      }
      null
    }

    /**
     * 恢复出厂：清空连接诊断与最近窗口信息，不关闭无障碍权限。
     */
    AsyncFunction("clearDeviceObserverDataForFactoryReset") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      DeviceObserverConnectionStore.clearAllForFactoryReset(context)
      // 截图与应用图标都属于可再生成的私有 cache；恢复出厂不保留它们，
      // 也绝不根据 URI 去触碰相册或 document provider 的外部文件。
      ManagedScreenshotFile.directory(context).deleteRecursively()
      InstalledLaunchableAppQuery(context).clearIconCache()
      null
    }.runOnQueue(Queues.DEFAULT)
  }

  private fun parseExpectedWindowIdentity(value: Any?): DeviceWindowIdentity {
    val payload = value as? Map<*, *>
      ?: throw DeviceScreenshotException(
        "window_unavailable",
        "截图请求缺少已经过隐私校验的窗口身份",
      )
    val windowId = (payload["windowId"] as? Number)?.toInt()
      ?: throw DeviceScreenshotException(
        "window_unavailable",
        "截图请求缺少有效的窗口 ID",
      )
    return DeviceWindowIdentity(
      packageName = (payload["packageName"] as? String)?.trim()?.takeIf { it.isNotEmpty() },
      windowId = windowId,
    )
  }

  private fun parseExpectedSemanticWindowIdentity(value: Any?): DeviceWindowIdentity {
    val payload = value as? Map<*, *>
      ?: throw DeviceSemanticReadException(
        "window_unavailable",
        "语义读取请求缺少已经过隐私校验的窗口身份",
      )
    val packageName = (payload["packageName"] as? String)?.trim()?.takeIf { it.isNotEmpty() }
      ?: throw DeviceSemanticReadException(
        "window_unavailable",
        "语义读取请求缺少有效的窗口包名",
      )
    val windowId = (payload["windowId"] as? Number)?.toInt()
      ?: throw DeviceSemanticReadException(
        "window_unavailable",
        "语义读取请求缺少有效的窗口 ID",
      )
    return DeviceWindowIdentity(packageName = packageName, windowId = windowId)
  }

  private fun getConnectionState(context: Context): Map<String, Any?> {
    return mapOf(
      "accessibilityEnabled" to isAccessibilityEnabled(context),
      "accessibilityConnected" to DeviceObserverAccessibilityService.isConnected(),
      "canRetrieveWindowContent" to
        DeviceObserverAccessibilityService.canRetrieveWindowContent(),
      "canTakeScreenshot" to DeviceObserverAccessibilityService.canTakeScreenshot(),
      "connectedAtEpochMs" to
        DeviceObserverConnectionStore.readConnectedAtEpochMs(context),
      "lastDisconnectedAtEpochMs" to
        DeviceObserverConnectionStore.readDisconnectedAtEpochMs(context),
      "lastEventAtEpochMs" to
        DeviceObserverConnectionStore.readLastEventAtEpochMs(context),
    )
  }

  private fun isAccessibilityEnabled(context: Context): Boolean {
    val accessibilityManager =
      context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    if (!accessibilityManager.isEnabled) {
      return false
    }

    val expectedComponent = ComponentName(
      context,
      DeviceObserverAccessibilityService::class.java,
    )
    return accessibilityManager
      .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
      .any { service ->
        val serviceInfo = service.resolveInfo.serviceInfo
        ComponentName(serviceInfo.packageName, serviceInfo.name) == expectedComponent
      }
  }
}
