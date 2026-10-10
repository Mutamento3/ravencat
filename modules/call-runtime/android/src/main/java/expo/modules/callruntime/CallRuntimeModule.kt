package expo.modules.callruntime

import android.net.Uri
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.androidoverlayruntime.OverlayPermissionGateway
import kotlinx.coroutines.*
import com.facebook.react.common.LifecycleState
import com.facebook.react.bridge.ReactContext
import java.io.File

private class CallRuntimeException(message: String) : CodedException(message)

/** Expo 生命周期回调可能来自 React 销毁线程；清理不能依赖将被取消的模块 scope。 */
internal fun dispatchCallLifecycle(action: () -> Unit) {
  if (Looper.myLooper() == Looper.getMainLooper()) action()
  else Handler(Looper.getMainLooper()).post { action() }
}

class CallRuntimeModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val emitter: (String, Map<String, Any?>) -> Unit = { name, data -> sendEvent(name, data) }
  private var ownedContext: ReactContext? = null
  private val context: ReactContext get() = appContext.reactContext as ReactContext
  private fun run(promise: Promise, action: suspend () -> Any?) {
    scope.launch {
      try { promise.resolve(action()) }
      catch (failure: Exception) { promise.reject(CallRuntimeException(failure.message ?: "通话原生执行失败")) }
    }
  }
  override fun definition() = ModuleDefinition {
    Name("CallRuntime")
    Events("onCommand", "onCancelled", "onRoute")
    OnCreate {
      val initialContext = context
      ownedContext = initialContext
      val visible = initialContext.lifecycleState == LifecycleState.RESUMED
      dispatchCallLifecycle {
        CallExecutionRegistry.emit = emitter
        CallExecutionRegistry.appVisible = visible
      }
    }
    AsyncFunction("start") { options: Map<String, Any?>, promise: Promise -> run(promise) {
      if (!CallExecutionRegistry.alive || CallExecutionRegistry.callId != options["callId"]) {
        checkNotNull(appContext.currentActivity) { "开始通话需要可见界面" }
        check((appContext.reactContext as ReactContext).lifecycleState == LifecycleState.RESUMED) { "开始通话需要可见界面" }
      }
      CallExecutionRegistry.start(context, options); null
    } }
    AsyncFunction("ready") { id: String, promise: Promise -> run(promise) {
      CallExecutionRegistry.requireHost(id)
      CallExecutionRegistry.ready.complete(Unit); null
    } }
    AsyncFunction("finish") { id: String, promise: Promise -> run(promise) {
      if (CallExecutionRegistry.callId == id) {
        CallExecutionRegistry.alive = false
        CallExecutionRegistry.host?.finish()
      }
      null
    } }
    AsyncFunction("activate") { id: String, promise: Promise -> run(promise) { CallExecutionRegistry.requireHost(id).activate(); null } }
    AsyncFunction("releaseAudio") { id: String, promise: Promise -> run(promise) {
      if (CallExecutionRegistry.callId == id) CallExecutionRegistry.host?.releaseAudio()
      null
    } }
    AsyncFunction("isAlive") { id: String -> CallExecutionRegistry.callId == id && CallExecutionRegistry.alive }
    AsyncFunction("getPendingCommands") { id: String -> CallExecutionRegistry.pending(id) }
    AsyncFunction("acknowledge") { id: String, error: String?, promise: Promise -> run(promise) { CallExecutionRegistry.acknowledge(id, error); null } }
    AsyncFunction("setCamera") { id: String, enabled: Boolean, facing: String, promise: Promise -> run(promise) { CallExecutionRegistry.requireHost(id).setCamera(enabled, facing); null } }
    AsyncFunction("capture") { id: String, promise: Promise -> run(promise) { CallExecutionRegistry.requireHost(id).camera.snapshot() } }
    AsyncFunction("deleteSnapshot") { uri: String, promise: Promise -> run(promise) {
      withContext(Dispatchers.IO) {
        val file = File(checkNotNull(Uri.parse(uri).path)).canonicalFile
        check(file.parentFile == File(context.cacheDir, "call-snapshots").canonicalFile)
        check(!file.exists() || file.delete()) { "临时通话帧删除失败" }
      }; null
    } }
    AsyncFunction("setMicrophone") { id: String, enabled: Boolean, promise: Promise -> run(promise) { CallExecutionRegistry.requireHost(id).setMicrophone(enabled); null } }
    AsyncFunction("setPresentation") { id: String, value: Boolean, promise: Promise -> run(promise) {
      if (CallExecutionRegistry.alive && CallExecutionRegistry.callId == id) CallExecutionRegistry.host?.overlay?.setFullScreen(value)
      null
    } }
    AsyncFunction("getRouteState") { promise: Promise -> run(promise) { CallExecutionRegistry.host?.routeState() } }
    AsyncFunction("selectRoute") { id: String, route: String, promise: Promise -> run(promise) { CallExecutionRegistry.requireHost(id).selectRoute(route); null } }
    AsyncFunction("hasOverlayPermission") { OverlayPermissionGateway.isGranted(context) }
    AsyncFunction("requestOverlayPermission") { promise: Promise -> run(promise) { OverlayPermissionGateway.openSettings(checkNotNull(appContext.currentActivity)); null } }
    OnActivityEntersForeground {
      dispatchCallLifecycle {
        if (CallExecutionRegistry.emit === emitter) {
          CallExecutionRegistry.appVisible = true
          CallExecutionRegistry.host?.overlay?.setAppVisible(true)
        }
      }
    }
    OnActivityEntersBackground {
      dispatchCallLifecycle {
        if (CallExecutionRegistry.emit === emitter) {
          CallExecutionRegistry.appVisible = false
          CallExecutionRegistry.host?.overlay?.setAppVisible(false)
        }
      }
    }
    OnDestroy {
      val destroyedContext = ownedContext
      dispatchCallLifecycle {
        if (CallExecutionRegistry.emit === emitter) CallExecutionRegistry.emit = null
        // bridge 与执行宿主按 ReactContext 配对；旧实例只能结束它自己的电话。
        if (destroyedContext != null && CallExecutionRegistry.executionContext === destroyedContext) {
          CallExecutionRegistry.alive = false
          CallExecutionRegistry.host?.finish()
          if (CallExecutionRegistry.host == null) {
            CallExecutionRegistry.ready.completeExceptionally(CancellationException("通话桥已销毁"))
            CallExecutionRegistry.released.complete(Unit)
            CallExecutionRegistry.executionContext = null
          }
        }
      }
      scope.cancel()
    }
  }
}
