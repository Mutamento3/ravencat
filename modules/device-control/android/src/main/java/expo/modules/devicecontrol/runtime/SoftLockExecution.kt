package expo.modules.devicecontrol.runtime

import android.os.Handler
import android.os.Looper
import kotlin.math.max

/** 串行投递 Android UI 副作用；生产实现始终进入 main looper，单测可控。 */
fun interface SoftLockMainThreadExecutor {
  fun execute(action: () -> Unit)
}

class AndroidSoftLockMainThreadExecutor(
  private val handler: Handler = Handler(Looper.getMainLooper()),
) : SoftLockMainThreadExecutor {
  override fun execute(action: () -> Unit) {
    if (Looper.myLooper() == handler.looper) {
      action()
    } else {
      handler.post(action)
    }
  }
}

/** native 执行租约到期唤醒；不写业务状态，不持久化 projection。 */
interface SoftLockExpiryScheduler {
  fun schedule(
    expiresAtEpochMs: Long,
    onExpiry: () -> Unit,
  )

  fun cancel()
}

class AndroidSoftLockExpiryScheduler(
  private val handler: Handler = Handler(Looper.getMainLooper()),
  private val nowEpochMs: () -> Long = System::currentTimeMillis,
) : SoftLockExpiryScheduler {
  private var pending: Runnable? = null

  override fun schedule(expiresAtEpochMs: Long, onExpiry: () -> Unit) {
    cancel()
    val task = Runnable {
      pending = null
      onExpiry()
    }
    pending = task
    handler.postDelayed(task, max(expiresAtEpochMs - nowEpochMs(), 0L))
  }

  override fun cancel() {
    pending?.let(handler::removeCallbacks)
    pending = null
  }
}
