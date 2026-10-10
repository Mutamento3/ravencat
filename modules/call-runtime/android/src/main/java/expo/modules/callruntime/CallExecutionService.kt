package expo.modules.callruntime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.PowerManager
import android.telecom.DisconnectCause
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import androidx.core.telecom.*
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import expo.modules.androidoverlayruntime.OverlayLaunchIntentFactory
import expo.modules.androidoverlayruntime.OverlayInteractionExclusion
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first

/** 一次通话的有界执行期，任务完成即释放；不随产品开关常驻，不自重启。 */
class CallExecutionService : Service(), HeadlessJsTaskEventListener {
  internal lateinit var callId: String
  internal lateinit var returnUri: Uri
  internal var name = ""
  internal var avatarBitmap: Bitmap? = null
    private set
  private var direction = ""
  internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  internal val camera by lazy { CallCameraSession(this) }
  internal val overlay by lazy { CallOverlayController(this) }
  private var callControl: CallControlScope? = null
  private var telecomJob: Job? = null
  private var route: CallAudioRouteController? = null
  private var endpoints = emptyList<CallEndpointCompat>()
  private var endpoint: CallEndpointCompat? = null
  private val endpointIds = linkedMapOf<String, Int>()
  private var microphoneTypeAcquired = false
  private var cameraEnabled = false
  private var finishing = false
  private var started = false
  private var connectedAt: Long? = null
  private var activation: CompletableDeferred<Unit>? = null
  private var executionTaskId: Int? = null
  private var taskContext: HeadlessJsTaskContext? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var cameraRevision = 0
  private val handler = Handler(Looper.getMainLooper())

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "hangup") {
      if (intent.getStringExtra("callId") == CallExecutionRegistry.callId) {
        scope.launch {
          try { CallExecutionRegistry.command("hangup") }
          catch (failure: Exception) { finish() }
        }
      }
      return Service.START_NOT_STICKY
    }
    if (started) return Service.START_NOT_STICKY
    if (!CallExecutionRegistry.alive || intent?.getStringExtra("callId") != CallExecutionRegistry.callId) {
      stopSelf(startId)
      return Service.START_NOT_STICKY
    }
    started = true
    val startIntent = checkNotNull(intent)
    callId = startIntent.getStringExtra("callId")!!
    name = startIntent.getStringExtra("name")!!
    direction = startIntent.getStringExtra("direction")!!
    returnUri = Uri.parse(startIntent.getStringExtra("returnUri")!!)
    CallExecutionRegistry.host = this
    try {
      OverlayInteractionExclusion.acquire(this)
      (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(
        NotificationChannel(CHANNEL, "正在通话", NotificationManager.IMPORTANCE_LOW),
      )
      updateForeground()
      startIntent.getStringExtra("avatarUri")?.let { uri ->
        scope.launch {
          val bitmap = loadAvatar(uri)
          if (finishing) return@launch
          avatarBitmap = bitmap
          overlay.avatarChanged()
          updateForeground()
        }
      }
      overlay.setAppVisible(CallExecutionRegistry.appVisible)
      // 不借用其他 Headless service 的静态锁；本通执行期独立持有并在 onDestroy 释放。
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(
        PowerManager.PARTIAL_WAKE_LOCK, "RavenCat:CallExecution",
      ).apply { acquire() }
      // 通话只从可见的 React 入口准入；明确持有返回的任务身份。
      // 全局 Headless listener 也会收到 Companion 等任务完成，不能据此结束电话。
      val context = HeadlessJsTaskContext.getInstance(checkNotNull(CallExecutionRegistry.executionContext))
      taskContext = context
      context.addTaskEventListener(this)
      executionTaskId = context.startTask(HeadlessJsTaskConfig("RavenCatCallExecutionTask",
        Arguments.createMap().apply { putString("callId", callId) }, 0, true))
    } catch (failure: Exception) {
      CallExecutionRegistry.ready.completeExceptionally(failure)
      finish()
    }
    return Service.START_NOT_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null
  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    if (taskId != executionTaskId) return
    finish()
    // finish 持有 Telecom 释放直到完成后 stopSelf。
  }

  internal suspend fun activate() {
    activation?.let { it.await(); return }
    val established = CompletableDeferred<Unit>()
    activation = established
    val manager = CallsManager(this)
    manager.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
    telecomJob = scope.launch {
      try {
        // 来电壳继续拥有 ringing；接听提交后才创建系统 active 投影，避免第二份来电 surface。
        manager.addCall(
          CallAttributesCompat(name, Uri.parse("ravencat-call:$callId"),
            if (direction == "incoming") CallAttributesCompat.DIRECTION_INCOMING else CallAttributesCompat.DIRECTION_OUTGOING,
            CallAttributesCompat.CALL_TYPE_VIDEO_CALL, callCapabilities = 0),
          onAnswer = { },
          onDisconnect = { CallExecutionRegistry.command("hangup") },
          onSetActive = { check(CallExecutionRegistry.alive) },
          onSetInactive = { CallExecutionRegistry.command("interrupted") },
        ) {
          callControl = this
          launch {
            try {
              val result = if (direction == "incoming") answer(CallAttributesCompat.CALL_TYPE_VIDEO_CALL) else setActive()
              check(result is CallControlResult.Success) { "系统无法接通电话：$result" }
              endpoints = availableEndpoints.first { it.isNotEmpty() }
              endpoint = currentCallEndpoint.first()
              val controller = CallAudioRouteController(callId,
                getDevices = { endpoints.mapNotNull { device(it) } },
                getCurrentDevice = { endpoint?.let { device(it) } },
                requestDevice = { id ->
                  val target = endpoints.first { device(it)?.id == id }
                  scope.launch {
                    try {
                      val changed = requestEndpointChange(target)
                      if (changed is CallControlResult.Error) route?.requestFailed(id, "系统未接受音频设备切换：$changed")
                    } catch (failure: Exception) { route?.requestFailed(id, failure.message ?: "系统未接受音频设备切换") }
                  }
                  true
                },
                scheduleTimeout = { timeout ->
                  val task = Runnable { timeout() }
                  handler.postDelayed(task, 30_000)
                  val cancel: () -> Unit = { handler.removeCallbacks(task) }
                  cancel
                },
                emit = { CallExecutionRegistry.emit?.invoke("onRoute", it) },
              )
              route = controller
              launch { currentCallEndpoint.collect { endpoint = it; controller.actualChanged() } }
              launch { availableEndpoints.collect { endpoints = it; controller.devicesChanged() } }
              launch { isMuted.collect { muted -> CallExecutionRegistry.command("mute", muted) } }
              controller.begin { message ->
                if (message == null) established.complete(Unit)
                else established.completeExceptionally(IllegalStateException(message))
              }
              connectedAt = System.currentTimeMillis()
              updateForeground()
            } catch (failure: Exception) { established.completeExceptionally(failure) }
          }
        }
        if (!finishing && established.isCompleted) CallExecutionRegistry.command("interrupted")
      } catch (failure: Exception) {
        established.completeExceptionally(failure)
        if (!finishing && CallExecutionRegistry.alive) {
          try { CallExecutionRegistry.command("interrupted") } finally { finish() }
        }
      }
    }
    established.await()
    overlay.connected()
  }

  private fun device(value: CallEndpointCompat): CallAudioDevice? {
    val kind = when (value.type) {
      CallEndpointCompat.TYPE_EARPIECE -> "earpiece"
      CallEndpointCompat.TYPE_SPEAKER -> "speaker"
      CallEndpointCompat.TYPE_BLUETOOTH, CallEndpointCompat.TYPE_WIRED_HEADSET -> "headset"
      else -> return null
    }
    val id = endpointIds.getOrPut(value.identifier.toString()) { endpointIds.size + 1 }
    return CallAudioDevice(id, kind)
  }

  internal fun routeState(): Map<String, Any?>? = route?.snapshot()
  internal fun releaseAudio() { route?.close(); route = null }
  internal suspend fun selectRoute(value: String) {
    val result = CompletableDeferred<Unit>()
    checkNotNull(route).select(value) { message ->
      if (message == null) result.complete(Unit) else result.completeExceptionally(IllegalStateException(message))
    }
    result.await()
  }

  internal fun setMicrophone(enabled: Boolean) {
    // 在可见流程首次取得 microphone 执行资格，保留到通话结束。
    // 静音/文字输入仍停止真实采集；不能撤销服务资格后再从后台重新申请。
    if (enabled && !microphoneTypeAcquired) {
      microphoneTypeAcquired = true
      try { updateForeground() }
      catch (failure: Exception) { microphoneTypeAcquired = false; throw failure }
    }
  }

  internal suspend fun setCamera(enabled: Boolean, facing: String) {
    val revision = ++cameraRevision
    cameraEnabled = enabled
    try {
      // 先切换展示并挂载预览，不能等相机绑定完成后才给它 surface。
      overlay.setCameraEnabled(enabled)
      updateForeground(); camera.setEnabled(enabled, facing)
    }
    catch (failure: Exception) {
      if (revision == cameraRevision) { cameraEnabled = false; overlay.setCameraEnabled(false); updateForeground() }
      throw failure
    }
  }

  private fun updateForeground() {
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
    if (microphoneTypeAcquired) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    if (cameraEnabled) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
    startForeground(NOTIFICATION_ID, notification(), types)
  }

  private fun notification(): Notification {
    val hangupIntent = Intent(this, CallExecutionService::class.java).apply { action = "hangup"; putExtra("callId", callId) }
    val hangup = PendingIntent.getService(this, callId.hashCode(), hangupIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val caller = Person.Builder().setName(name).apply {
      avatarBitmap?.let { setIcon(IconCompat.createWithBitmap(it)) }
    }.build()
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.sym_call_incoming)
      .setLargeIcon(avatarBitmap)
      .setContentTitle(name).setContentText(if (connectedAt == null) "正在接通" else "视频通话中")
      .setContentIntent(OverlayLaunchIntentFactory.createPendingIntent(this, returnUri))
      .setStyle(NotificationCompat.CallStyle.forOngoingCall(caller, hangup))
      .setOngoing(true).setCategory(NotificationCompat.CATEGORY_CALL)
      .setWhen(connectedAt ?: System.currentTimeMillis()).setUsesChronometer(connectedAt != null).build()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    camera.updateRotation()
    if (started) overlay.reposition()
  }

  private suspend fun loadAvatar(value: String): Bitmap? = withContext(Dispatchers.IO) {
    // 文件边界只在宿主读取一次，小窗与系统通知共享头像；图片失败不终止媒体。
    try {
      val uri = Uri.parse(value)
      val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
      check(options.outWidth > 0 && options.outHeight > 0) { "通话头像不是有效图片" }
      var sample = 1
      while (maxOf(options.outWidth, options.outHeight) / (sample * 2) >= 512) sample *= 2
      contentResolver.openInputStream(uri).use {
        checkNotNull(BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }))
      }
    } catch (failure: Exception) {
      if (failure is CancellationException) throw failure
      android.util.Log.w("CallExecution", "通话头像读取失败", failure)
      null
    }
  }

  internal fun finish() {
    if (finishing) return
    finishing = true
    CallExecutionRegistry.alive = false
    activation?.completeExceptionally(IllegalStateException("通话已经结束"))
    overlay.close()
    camera.close()
    route?.close()
    OverlayInteractionExclusion.release(this)
    scope.launch {
      try { withTimeout(4_000) { callControl?.disconnect(DisconnectCause(DisconnectCause.LOCAL)) } }
      finally {
        telecomJob?.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
  }

  override fun onDestroy() {
    if (started) { overlay.close(); camera.close(); route?.close() }
    OverlayInteractionExclusion.release(this)
    CallExecutionRegistry.cancelled(this)
    scope.cancel()
    taskContext?.removeTaskEventListener(this)
    wakeLock?.release()
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    private const val CHANNEL = "ravencat-ongoing-call"
    private const val NOTIFICATION_ID = 41073
  }
}
