package expo.modules.callruntime

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** 采集归属通话，唯一小窗只提供预览 surface，不拥有 camera 或 snapshot 生命周期。 */
internal class CallCameraSession(private val context: Context) : LifecycleOwner {
  private val registry = LifecycleRegistry(this)
  override val lifecycle: Lifecycle get() = registry
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var capture: ImageCapture? = null
  private var facing: String? = null
  private var view: PreviewView? = null
  @Volatile private var closed = false
  @Volatile private var generation = 0
  private val captures = AtomicInteger(0)
  private val io = Executors.newSingleThreadExecutor()
  private val main = ContextCompat.getMainExecutor(context)

  init { registry.currentState = Lifecycle.State.RESUMED }

  suspend fun setEnabled(enabled: Boolean, nextFacing: String) {
    check(!closed) { "通话相机已经释放" }
    val version = ++generation
    if (!enabled) { unbind(); return }
    if (capture != null && nextFacing == facing) return
    val cameraProvider = provider ?: suspendCancellableCoroutine { continuation ->
      val future = ProcessCameraProvider.getInstance(context)
      future.addListener({
        try { continuation.resume(future.get()) }
        catch (failure: Exception) { continuation.resumeWithException(failure) }
      }, main)
    }
    if (closed || generation != version) throw IllegalStateException("通话相机请求已取消")
    provider = cameraProvider
    unbind()
    val nextPreview = Preview.Builder().build()
    val nextCapture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
      .setJpegQuality(72).build()
    preview = nextPreview
    capture = nextCapture
    facing = nextFacing
    nextPreview.setSurfaceProvider(view?.surfaceProvider)
    try {
      cameraProvider.bindToLifecycle(this,
        if (nextFacing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA,
        nextPreview, nextCapture)
      updateRotation()
    } catch (failure: Exception) { unbind(); throw failure }
  }

  fun attach(nextView: PreviewView) {
    view = nextView
    preview?.setSurfaceProvider(nextView.surfaceProvider)
    updateRotation()
  }

  fun detach(oldView: PreviewView) {
    if (view !== oldView) return
    view = null
    preview?.setSurfaceProvider(null)
  }

  fun updateRotation() {
    val rotation = view?.display?.rotation ?: return
    // PreviewView 自己按所属 display 旋转，不能把尚未挂载的 View 方向固化为目标方向。
    capture?.targetRotation = rotation
  }

  @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
  suspend fun snapshot(): Map<String, Any> {
    val camera = checkNotNull(capture) { "摄像头未开启" }
    val version = generation
    return suspendCancellableCoroutine { continuation ->
      captures.incrementAndGet()
      camera.takePicture(io, object : ImageCapture.OnImageCapturedCallback() {
        override fun onCaptureSuccess(image: ImageProxy) {
          var file: File? = null
          try {
            val buffer = image.planes[0].buffer
            val data = ByteArray(buffer.remaining()).also { buffer.get(it) }
            val bitmap = checkNotNull(BitmapFactory.decodeByteArray(data, 0, data.size))
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height,
              Matrix().apply { postRotate(image.imageInfo.rotationDegrees.toFloat()) }, true)
            val directory = File(context.cacheDir, "call-snapshots").apply { mkdirs() }
            file = File.createTempFile("frame-", ".jpg", directory)
            file.outputStream().use { check(rotated.compress(Bitmap.CompressFormat.JPEG, 72, it)) { "通话帧编码失败" } }
            val result = mapOf("uri" to Uri.fromFile(file).toString(), "width" to rotated.width, "height" to rotated.height)
            if (rotated !== bitmap) rotated.recycle()
            bitmap.recycle()
            if (closed || generation != version || !continuation.isActive) {
              file.delete()
              if (continuation.isActive) continuation.resumeWithException(IllegalStateException("通话相机请求已取消"))
            } else continuation.resume(result) { file.delete() }
          } catch (failure: Exception) {
            file?.delete()
            if (continuation.isActive) continuation.resumeWithException(failure)
          } finally { image.close(); captureFinished() }
        }
        override fun onError(exception: ImageCaptureException) {
          if (continuation.isActive) continuation.resumeWithException(exception)
          captureFinished()
        }
      })
    }
  }

  private fun captureFinished() {
    if (captures.decrementAndGet() == 0 && closed) io.shutdown()
  }

  private fun unbind() {
    preview?.let { provider?.unbind(it) }
    capture?.let { provider?.unbind(it) }
    preview = null
    capture = null
    facing = null
  }

  fun close() {
    if (closed) return
    closed = true
    generation++
    unbind()
    view = null
    registry.currentState = Lifecycle.State.DESTROYED
    if (captures.get() == 0) io.shutdown()
  }
}
