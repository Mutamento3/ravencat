package expo.modules.ravencatfloatinglayer

import android.content.Context
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionExecutionPort
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionExecutionHost
import expo.modules.ravencatfloatinglayer.companion.RavenCatCompanionWakeDispatcher
import java.util.concurrent.atomic.AtomicInteger

internal class TestCompanionExecutionPort : RavenCatCompanionExecutionPort {
  var headlessStartAccepted = true
  val foregroundStarts = AtomicInteger(0)
  val foregroundStops = AtomicInteger(0)
  val headlessStarts = AtomicInteger(0)
  val cancelRequests = AtomicInteger(0)
  val headlessDeliveryEventIds = mutableListOf<String>()

  override fun requestExecutionForeground(
    context: Context,
    deliveryEventId: String,
    executionContext: String,
  ): Boolean {
    foregroundStarts.incrementAndGet()
    return true
  }

  override fun stopExecutionForeground(context: Context, deliveryEventId: String) {
    foregroundStops.incrementAndGet()
  }

  override fun isExecutionForegroundRunning(context: Context): Boolean = false

  override fun startHeadless(context: Context, event: RavenCatCompanionWakeEvent): Boolean {
    headlessStarts.incrementAndGet()
    val deliveryEventId = event.deliveryEventId ?: event.eventId
    headlessDeliveryEventIds += deliveryEventId
    RavenCatCompanionWakeDispatcher.notifyBridge(event)
    RavenCatCompanionExecutionHost.signalRunnerCompletion(deliveryEventId)
    return headlessStartAccepted
  }

  override fun cancelHeadlessExecution(context: Context, deliveryEventId: String) {
    cancelRequests.incrementAndGet()
  }

  fun reset() {
    headlessStartAccepted = true
    foregroundStarts.set(0)
    foregroundStops.set(0)
    headlessStarts.set(0)
    cancelRequests.set(0)
    headlessDeliveryEventIds.clear()
  }
}
