package expo.modules.deviceobserver

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * 接收系统窗口事件、维护当前窗口快照，并提供不含业务决策的无障碍截屏能力。
 *
 * 事件只向 [DeviceWindowObservationSource] publish，不感知订阅者数量；
 * 当前窗口诊断仍写入 [DeviceObserverConnectionStore]。
 */
class DeviceObserverAccessibilityService : AccessibilityService() {
  private val windowObservationTracker = DeviceWindowObservationTracker { state ->
    publishWindowState(state)
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    connectedService = this
    val connectedAtEpochMs = System.currentTimeMillis()
    DeviceObserverConnectionStore.recordConnected(this, connectedAtEpochMs)
    DeviceWindowObservationSource.registerSnapshotProvider { snapshotCurrentWindow() }
    DeviceWindowObservationSource.publishConnectionState(
      DeviceObserverConnectionState(
        connected = true,
        changedAtEpochMs = connectedAtEpochMs,
      ),
    )
    snapshotCurrentWindow()?.let(windowObservationTracker::publishIfChanged)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent) {
    if (
      event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED &&
      event.eventType != AccessibilityEvent.TYPE_WINDOWS_CHANGED
    ) {
      return
    }
    windowObservationTracker.observeRawWindowEvent(::resolveCurrentForegroundWindow)
  }

  override fun onInterrupt() {
    // Android 暂停反馈时不代表服务已经解绑，连接状态保持不变。
  }

  override fun onUnbind(intent: android.content.Intent?): Boolean {
    markDisconnected()
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    markDisconnected()
    super.onDestroy()
  }

  internal fun snapshotCurrentWindow(): DeviceWindowState? {
    return resolveCurrentForegroundWindow()
  }

  internal fun snapshotCurrentWindowWithRevision(): DeviceWindowRevisionSnapshot {
    return DeviceWindowRevisionSnapshot(
      windowState = snapshotCurrentWindow(),
      revision = windowObservationTracker.revision,
    )
  }

  internal fun canRetrieveWindowContent(): Boolean {
    return serviceInfo.capabilities and
      AccessibilityServiceInfo.CAPABILITY_CAN_RETRIEVE_WINDOW_CONTENT != 0
  }

  internal fun canTakeScreenshot(): Boolean {
    return serviceInfo.capabilities and
      AccessibilityServiceInfo.CAPABILITY_CAN_TAKE_SCREENSHOT != 0
  }

  internal fun readSemanticSnapshot(expected: DeviceWindowIdentity): DeviceSemanticSnapshot {
    if (!canRetrieveWindowContent()) {
      throw DeviceSemanticReadException(
        "semantic_read_failed",
        "Android 无障碍服务没有窗口内容读取能力",
      )
    }

    DeviceSemanticWindowFence.assertReadStart(expected, snapshotCurrentWindow())
    val root = findExpectedWindowRoot(expected)
    return try {
      DeviceSemanticSnapshotReader.read(expected, root)
    } catch (error: Exception) {
      if (error is DeviceSemanticReadException) throw error
      throw DeviceSemanticReadException(
        "semantic_read_failed",
        "Android 无障碍语义树读取失败",
        error,
      )
    }
  }

  internal suspend fun captureScreenshot(
    target: String,
    windowState: DeviceWindowState,
  ): Pair<CapturedScreenshotBitmap, String> {
    if (!canTakeScreenshot()) {
      throw DeviceScreenshotException(
        "screenshot_capability_missing",
        "Android 无障碍服务没有截屏能力",
      )
    }

    // Launcher 的应用窗口本身通常是透明 Surface，壁纸由系统在它下面单独合成。
    // 若仍调用 takeScreenshotOfWindow，只会得到“图标 + 透明底”；主屏必须截默认显示器
    // 才能得到用户实际看到的壁纸与图标合成结果。
    val effectiveTarget = if (
      target == "current_window" && isDefaultHomePackage(windowState.packageName)
    ) {
      "default_display"
    } else {
      target
    }

    return suspendCancellableCoroutine { continuation ->
      val callback = object : TakeScreenshotCallback {
        override fun onSuccess(screenshot: ScreenshotResult) {
          val hardwareBuffer = screenshot.hardwareBuffer
          try {
            val hardwareBitmap = Bitmap.wrapHardwareBuffer(
              hardwareBuffer,
              screenshot.colorSpace,
            )
            val softwareBitmap = hardwareBitmap
              ?.copy(Bitmap.Config.ARGB_8888, false)
              ?: throw DeviceScreenshotException(
                "capture_failed",
                "Android 截屏结果无法转换为图片",
              )
            hardwareBitmap.recycle()

            if (continuation.isActive) {
              continuation.resume(
                CapturedScreenshotBitmap(
                  bitmap = softwareBitmap,
                  capturedAtEpochMs = System.currentTimeMillis(),
                ) to resolveScreenshotSource(effectiveTarget),
              )
            } else {
              softwareBitmap.recycle()
            }
          } catch (error: Exception) {
            if (continuation.isActive) {
              continuation.resumeWithException(
                if (error is DeviceScreenshotException) {
                  error
                } else {
                  DeviceScreenshotException(
                    "capture_failed",
                    "Android 截屏结果处理失败",
                    error,
                  )
                },
              )
            }
          } finally {
            hardwareBuffer.close()
          }
        }

        override fun onFailure(errorCode: Int) {
          if (continuation.isActive) {
            continuation.resumeWithException(mapScreenshotFailure(errorCode))
          }
        }
      }

      try {
        if (
          effectiveTarget == "current_window" &&
          Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
        ) {
          val windowId = windowState.windowId
            ?: throw DeviceScreenshotException(
              "invalid_window",
              "当前无障碍窗口缺少有效 window id",
            )
          takeScreenshotOfWindow(windowId, mainExecutor, callback)
        } else {
          takeScreenshot(DEFAULT_DISPLAY_ID, mainExecutor, callback)
        }
      } catch (error: Exception) {
        if (continuation.isActive) {
          continuation.resumeWithException(
            if (error is DeviceScreenshotException) {
              error
            } else {
              DeviceScreenshotException(
                "capture_failed",
                "无法启动 Android 无障碍截屏",
                error,
              )
            },
          )
        }
      }
    }
  }

  private fun resolveCurrentForegroundWindow(): DeviceWindowState {
    return DeviceForegroundWindowResolver.resolve(
      windows = windows,
      checkedAtEpochMs = System.currentTimeMillis(),
      readWindowFact = { window -> window.toDeviceWindowFact() },
      readPackageName = { window -> window.root?.packageName?.toString() },
      readTitle = { window -> window.title?.toString() },
    )
  }

  private fun findExpectedWindowRoot(expected: DeviceWindowIdentity): AccessibilityNodeInfo {
    val expectedPackage = expected.packageName?.trim()?.lowercase()
      ?: throw DeviceSemanticReadException(
        "window_unavailable",
        "语义读取请求缺少窗口包名",
      )
    val window = windows.firstOrNull { candidate ->
      candidate.id == expected.windowId && candidate.type == AccessibilityWindowInfo.TYPE_APPLICATION
    } ?: throw DeviceSemanticReadException(
      "window_unavailable",
      "当前无障碍窗口没有可读取的语义根节点",
    )
    val root = window.root ?: throw DeviceSemanticReadException(
      "window_unavailable",
      "当前无障碍窗口没有可读取的语义根节点",
    )
    val actualPackage = root.packageName?.toString()?.trim()?.lowercase()
    if (actualPackage != expectedPackage) {
      throw DeviceSemanticReadException(
        "window_changed",
        "语义树不属于已经通过隐私校验的窗口",
      )
    }
    return root
  }

  private fun AccessibilityWindowInfo.toDeviceWindowFact(): DeviceAccessibilityWindowFact {
    return DeviceAccessibilityWindowFact(
      windowId = id,
      type = type,
      active = isActive,
      focused = isFocused,
    )
  }

  private fun isDefaultHomePackage(packageName: String?): Boolean {
    if (packageName.isNullOrBlank()) {
      return false
    }

    val homeIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    val homeActivity = packageManager.resolveActivity(
      homeIntent,
      PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()),
    )?.activityInfo
    return homeActivity?.packageName == packageName
  }

  private fun publishWindowState(state: DeviceWindowState) {
    DeviceObserverConnectionStore.recordWindowState(this, state)
    DeviceWindowObservationSource.publishWindowState(state)
  }

  private fun markDisconnected() {
    if (connectedService !== this) {
      return
    }

    val disconnectedAtEpochMs = System.currentTimeMillis()
    connectedService = null
    DeviceObserverConnectionStore.recordDisconnected(this, disconnectedAtEpochMs)
    DeviceWindowObservationSource.registerSnapshotProvider(null)
    DeviceWindowObservationSource.publishConnectionState(
      DeviceObserverConnectionState(
        connected = false,
        changedAtEpochMs = disconnectedAtEpochMs,
      ),
    )
  }

  private fun resolveScreenshotSource(target: String): String {
    return if (
      target == "current_window" &&
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    ) {
      "accessibility_window"
    } else {
      "accessibility_display"
    }
  }

  private fun mapScreenshotFailure(errorCode: Int): DeviceScreenshotException {
    return when (errorCode) {
      ERROR_TAKE_SCREENSHOT_NO_ACCESSIBILITY_ACCESS -> DeviceScreenshotException(
        "accessibility_disconnected",
        "Android 已撤销无障碍截屏访问",
      )
      ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> DeviceScreenshotException(
        "capture_interval_too_short",
        "两次设备观察截屏间隔过短",
      )
      ERROR_TAKE_SCREENSHOT_INVALID_DISPLAY -> DeviceScreenshotException(
        "invalid_display",
        "Android 默认显示器不可用于截屏",
      )
      ERROR_TAKE_SCREENSHOT_INVALID_WINDOW -> DeviceScreenshotException(
        "invalid_window",
        "当前 Android 窗口不可用于截屏",
      )
      ERROR_TAKE_SCREENSHOT_SECURE_WINDOW -> DeviceScreenshotException(
        "secure_window",
        "当前窗口受 Android 安全标记保护",
      )
      else -> DeviceScreenshotException(
        "capture_failed",
        "Android 无障碍截屏失败，错误码：$errorCode",
      )
    }
  }

  companion object {
    private const val DEFAULT_DISPLAY_ID = 0

    @Volatile
    private var connectedService: DeviceObserverAccessibilityService? = null

    internal fun isConnected(): Boolean = connectedService != null

    internal fun canRetrieveWindowContent(): Boolean {
      return connectedService?.canRetrieveWindowContent() == true
    }

    internal fun canTakeScreenshot(): Boolean {
      return connectedService?.canTakeScreenshot() == true
    }

    internal fun connectedInstance(): DeviceObserverAccessibilityService? {
      return connectedService
    }

    internal fun currentWindowState(context: android.content.Context): DeviceWindowState {
      val liveState = connectedService?.snapshotCurrentWindow()
        ?: return DeviceWindowState.unknown()
      DeviceObserverConnectionStore.recordWindowState(context, liveState)
      return liveState
    }
  }
}
