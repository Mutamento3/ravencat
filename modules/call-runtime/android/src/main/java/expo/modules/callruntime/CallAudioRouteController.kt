package expo.modules.callruntime

internal data class CallAudioDevice(val id: Int, val route: String)

/** 一通电话的路由所有者；请求被接受不代表系统已经完成切换。 */
internal class CallAudioRouteController(
  val callId: String,
  private val getDevices: () -> List<CallAudioDevice>,
  private val getCurrentDevice: () -> CallAudioDevice?,
  private val requestDevice: (Int) -> Boolean,
  private val scheduleTimeout: (() -> Unit) -> (() -> Unit),
  private val emit: (Map<String, Any?>) -> Unit,
) {
  private var devices = getDevices()
  private var actual = getCurrentDevice()
  private var selectedDevice = actual
  private var preferredHeadset = actual?.takeIf { it.route == "headset" }
  private var revision = 0
  private var pending: Pending? = null
  private var error: String? = null
  private var closed = false
  private var queuedHeadset: CallAudioDevice? = null

  private class Pending(val device: CallAudioDevice, val complete: (String?) -> Unit) {
    var cancelTimeout: (() -> Unit)? = null
  }

  fun snapshot(): Map<String, Any?> = mapOf(
    "callId" to callId,
    "revision" to revision,
    "route" to actual?.route,
    "availableRoutes" to listOf("earpiece", "speaker", "headset").filter { route -> devices.any { it.route == route } },
    "pendingRoute" to pending?.device?.route,
    "errorMessage" to error,
  )

  fun begin(complete: (String?) -> Unit) {
    select(if (devices.any { it.route == "headset" }) "headset" else "earpiece", complete)
  }

  fun select(route: String, complete: (String?) -> Unit) {
    check(!closed)
    if (pending != null) {
      complete("正在切换音频设备，请稍候")
      return
    }
    val target = if (route == "headset") {
      devices.firstOrNull { it.id == preferredHeadset?.id }
        ?: devices.firstOrNull { it.route == route }
    } else devices.firstOrNull { it.route == route }
    if (target == null) {
      error = "所选通话音频设备不可用"
      publish()
      complete(error)
      return
    }
    error = null
    val request = Pending(target, complete)
    pending = request
    publish()
    try {
      if (!requestDevice(target.id)) {
        finish("系统未接受音频设备切换")
        return
      }
    } catch (failure: Exception) {
      finish(failure.message ?: "音频设备切换失败")
      return
    }
    // 同步生效的设备也从系统读取，绝不将目标值当成实际值。
    actualChanged()
    if (pending === request) {
      request.cancelTimeout = scheduleTimeout {
        actualChanged()
        if (pending === request) finish("音频设备切换未完成，请重新选择")
      }
    }
  }

  fun actualChanged() {
    if (closed) return
    actual = getCurrentDevice()
    if (pending != null && actual?.id == pending!!.device.id) {
      finish(null)
    } else {
      publish()
    }
  }

  /** Telecom 异步拒绝请求时终结当前请求，不重试抢路由。 */
  fun requestFailed(id: Int, message: String) {
    if (!closed && pending?.device?.id == id) finish(message)
  }

  fun devicesChanged() {
    if (closed) return
    val previous = devices
    devices = getDevices()
    actual = getCurrentDevice()
    val newHeadset = devices.firstOrNull { device ->
      device.route == "headset" && previous.none { it.id == device.id }
    }
    val removedPending = pending?.let { request -> devices.none { it.id == request.device.id } } == true
    // 系统可能先上报回退后的设备，再上报拔出；保留已确认的选择以处理两种事件顺序。
    val removedSelection = selectedDevice?.let { selected -> devices.none { it.id == selected.id } } == true
    if (removedSelection) selectedDevice = null
    if (removedPending) finish("音频设备已断开")
    if (closed) return
    if (newHeadset != null) {
      // 只在新耳机接入时自动选择一次，普通回调和播放开始不能覆盖手动选择。
      preferredHeadset = newHeadset
      if (pending != null) queuedHeadset = newHeadset
      else select("headset") {}
    } else if (removedSelection) {
      if (pending == null) select(if (devices.any { it.route == "headset" }) "headset" else "earpiece") {}
    } else {
      publish()
    }
  }

  fun close() {
    closed = true
    if (pending != null) finish("通话已结束")
  }

  private fun finish(message: String?) {
    val request = checkNotNull(pending)
    pending = null
    if (message == null) selectedDevice = request.device
    request.cancelTimeout?.invoke()
    error = message
    publish()
    request.complete(message)
    val queued = queuedHeadset
    queuedHeadset = null
    if (!closed && queued != null && devices.any { it.id == queued.id }) {
      select("headset") {}
    }
  }

  private fun publish() {
    revision += 1
    emit(snapshot())
  }
}
