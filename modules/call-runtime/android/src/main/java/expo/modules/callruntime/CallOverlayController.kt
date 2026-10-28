package expo.modules.callruntime

import android.app.AppOpsManager
import android.app.ActivityOptions
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.camera.view.PreviewView
import expo.modules.androidoverlayruntime.*

/** 只管理本通电话的展示；悬浮权限与悬浮球开关不拥有媒体执行期。 */
internal class CallOverlayController(private val service: CallExecutionService) {
  private val window = OverlayWindowHost(service)
  private val bounds = OverlayBoundsResolver(service)
  private val appOps = service.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
  private val handler = Handler(Looper.getMainLooper())
  private var root: CallFloatingFrame? = null
  private var preview: PreviewView? = null
  private var avatar: ImageView? = null
  private var params: WindowManager.LayoutParams? = null
  private var position: OverlayPosition? = null
  private var fullScreen = true
  private var cameraEnabled = false
  private var appVisible = true
  private var closed = false
  private var connectedAt: Long? = null
  private var title: TextView? = null
  private var restoring = false
  private var restoreRevision = 0
  private var attachedPresentation: View? = null
  private val permissionListener = AppOpsManager.OnOpChangedListener { operation, packageName ->
    if (operation == AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW && packageName == service.packageName) handler.post { update() }
  }
  private val tick = object : Runnable {
    override fun run() {
      val start = connectedAt
      val seconds = if (start == null) 0 else (System.currentTimeMillis() - start) / 1000
      title?.text = if (start == null) service.name else "${service.name} ${seconds / 60}:${(seconds % 60).toString().padStart(2, '0')}"
      if (root != null) handler.postDelayed(this, 1000)
    }
  }

  init { appOps.startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, service.packageName, permissionListener) }

  fun setFullScreen(value: Boolean) {
    if (fullScreen && !value) cancelRestore()
    fullScreen = value
    update()
  }
  fun setAppVisible(value: Boolean) {
    if (appVisible && !value) cancelRestore()
    appVisible = value
    if (value && restoring) attachedPresentation?.invalidate()
    update()
  }
  fun setCameraEnabled(value: Boolean) {
    if (cameraEnabled != value) cancelRestore()
    cameraEnabled = value
    preview?.visibility = if (value) View.VISIBLE else View.GONE
    avatar?.visibility = if (value) View.GONE else View.VISIBLE
    update()
  }
  fun connected() { connectedAt = System.currentTimeMillis() }
  fun avatarChanged() { avatar?.setImageBitmap(service.avatarBitmap) }

  private fun restore() {
    if ((fullScreen && appVisible) || restoring) return
    restoring = true
    restoreRevision++
    CallPresentationReturn.entered(service.callId, !CallPresentationReturn.isAppVisible)
    try {
      // 窗口保持小窗几何，只由通话页原地淡入，避免任务动画再次移动整幅画面。
      service.startActivity(OverlayLaunchIntentFactory.createIntent(service, service.returnUri),
        ActivityOptions.makeCustomAnimation(service, 0, 0).toBundle())
      attachedPresentation?.invalidate()
    } catch (failure: SecurityException) {
      CallPresentationReturn.leave(service.callId, null)
      cancelRestore()
      update()
    }
  }

  val pendingPresentation: Int? get() = if (restoring) restoreRevision else null
  fun ownsPresentation(view: View) = attachedPresentation === view

  fun attachPresentation(view: View) { attachedPresentation = view }

  fun setPresentationProgress(view: View, expected: Int, progress: Float) {
    if (attachedPresentation !== view || pendingPresentation != expected) return
    if (!cameraEnabled) root?.alpha = 1f - progress
  }

  fun completeRestore(view: View, expected: Int) {
    if (attachedPresentation !== view || pendingPresentation != expected) return
    restoring = false
    update()
    root?.alpha = 1f
    view.invalidate()
  }

  fun presentationDetached(view: View) {
    if (attachedPresentation !== view) return
    attachedPresentation = null
    cancelRestore()
    update()
  }

  private fun cancelRestore() {
    if (!restoring) return
    restoring = false
    root?.alpha = 1f
    attachedPresentation?.invalidate()
  }

  private fun update() {
    if (closed) return
    // 摄像头开启后只有这一块预览窗口，页面/Activity 切换不拆 surface 或重置位置。
    if (!OverlayPermissionGateway.isGranted(service)
      || (!cameraEnabled && fullScreen && appVisible && !restoring)) { remove(); return }
    if (root != null) return
    val size = OverlaySize(dp(112), dp(150))
    val available = bounds.resolveScreenBounds()
    val initial = OverlayGeometry.constrainVisible(position ?: OverlayPosition(available.right - size.width, available.top + dp(100)), size, available)
    val layout = OverlayWindowConfig(size.width, size.height,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
      x = initial.x, y = initial.y).toLayoutParams().apply {
      setFitInsetsTypes(0)
      layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
    }
    var anchor = initial
    val frame = CallFloatingFrame(service,
      onDragStart = { anchor = OverlayPosition(layout.x, layout.y) },
      onDragMove = { dx, dy ->
        move(OverlayGeometry.constrainVisible(OverlayPosition(anchor.x + dx.toInt(), anchor.y + dy.toInt()), size, bounds.resolveScreenBounds()))
      }, onDoubleTap = { restore() }).apply {
      background = GradientDrawable().apply { setColor(Color.BLACK); cornerRadius = dp(10).toFloat() }
      clipToOutline = true
      contentDescription = "通话小窗，双击返回通话，拖动移动"
    }
    val image = ImageView(service).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      setImageBitmap(service.avatarBitmap)
      visibility = if (cameraEnabled) View.GONE else View.VISIBLE
    }
    avatar = image
    frame.addView(image, FrameLayout.LayoutParams(-1, -1))
    val cameraView = PreviewView(service).apply {
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
      scaleType = PreviewView.ScaleType.FILL_CENTER
      visibility = if (cameraEnabled) View.VISIBLE else View.GONE
    }
    preview = cameraView
    frame.addView(cameraView, FrameLayout.LayoutParams(-1, -1))
    val heading = TextView(service).apply {
      setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11f); gravity = Gravity.CENTER
      setBackgroundColor(0x66000000); isSingleLine = true
      ellipsize = android.text.TextUtils.TruncateAt.END
      setPadding(dp(4), 0, dp(4), 0)
    }
    title = heading
    frame.addView(heading, FrameLayout.LayoutParams(-1, dp(24), Gravity.TOP))
    try {
      window.add(frame, layout)
      root = frame
      params = layout
      service.camera.attach(cameraView)
      handler.post(tick)
    } catch (failure: WindowManager.BadTokenException) { title = null; preview = null; avatar = null }
      catch (failure: SecurityException) { title = null; preview = null; avatar = null }
  }

  private fun move(position: OverlayPosition) {
    this.position = position
    val view = root ?: return
    val layout = checkNotNull(params)
    layout.x = position.x; layout.y = position.y
    try { window.update(view, layout) }
    catch (failure: SecurityException) { remove() }
  }

  fun reposition() {
    cancelRestore()
    val layout = params ?: return
    move(OverlayGeometry.constrainVisible(OverlayPosition(layout.x, layout.y), OverlaySize(layout.width, layout.height), bounds.resolveScreenBounds()))
  }

  private fun remove() {
    val view = root ?: return
    cancelRestore()
    preview?.let { service.camera.detach(it) }
    root = null; preview = null; params = null; title = null; avatar = null
    handler.removeCallbacks(tick)
    // 系统撤销权限时可能先移除窗口；此处仅释放已消失的展示句柄。
    try { window.remove(view) } catch (_: IllegalArgumentException) { }
  }

  fun close() {
    if (closed) return
    closed = true
    remove()
    attachedPresentation = null
    appOps.stopWatchingMode(permissionListener)
  }
  private fun dp(value: Int) = (value * service.resources.displayMetrics.density).toInt()
}
