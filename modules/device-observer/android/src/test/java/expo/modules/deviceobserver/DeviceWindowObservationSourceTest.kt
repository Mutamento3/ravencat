package expo.modules.deviceobserver

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceWindowObservationSourceTest {
  private val subscriptions = mutableListOf<DeviceWindowObservationSubscription>()

  @After
  fun cancelSubscriptions() {
    subscriptions.forEach(DeviceWindowObservationSubscription::cancel)
    subscriptions.clear()
    DeviceWindowObservationSource.registerSnapshotProvider(null)
  }

  @Test
  fun `subscriber A and B both receive window event`() {
    val receivedByA = mutableListOf<DeviceWindowState>()
    val receivedByB = mutableListOf<DeviceWindowState>()
    subscribeWindow(receivedByA::add)
    subscribeWindow(receivedByB::add)

    val state = windowState("com.example.target")
    DeviceWindowObservationSource.publishWindowState(state)

    assertEquals(listOf(state), receivedByA)
    assertEquals(listOf(state), receivedByB)
  }

  @Test
  fun `after A cancels B still receives`() {
    val receivedByA = mutableListOf<DeviceWindowState>()
    val receivedByB = mutableListOf<DeviceWindowState>()
    val subscriptionA = subscribeWindow(receivedByA::add)
    subscribeWindow(receivedByB::add)

    subscriptionA.cancel()
    DeviceWindowObservationSource.publishWindowState(windowState("com.example.target"))

    assertTrue(receivedByA.isEmpty())
    assertEquals(1, receivedByB.size)
  }

  @Test
  fun `cancelled subscriber receives no further events`() {
    val received = mutableListOf<DeviceWindowState>()
    val subscription = subscribeWindow(received::add)

    val first = windowState("com.example.first")
    DeviceWindowObservationSource.publishWindowState(first)
    subscription.cancel()
    DeviceWindowObservationSource.publishWindowState(windowState("com.example.second"))

    assertEquals(listOf(first), received)
  }

  @Test
  fun `repeated subscribe does not overwrite earlier listener`() {
    // 旧单槽 setter 会覆盖第一个 listener；多订阅者语义下两者都必须保留。
    val receivedByFirst = mutableListOf<DeviceWindowState>()
    val receivedBySecond = mutableListOf<DeviceWindowState>()
    subscribeWindow(receivedByFirst::add)
    subscribeWindow(receivedBySecond::add)

    val state = windowState("com.example.target")
    DeviceWindowObservationSource.publishWindowState(state)

    assertEquals(listOf(state), receivedByFirst)
    assertEquals(listOf(state), receivedBySecond)
  }

  @Test
  fun `connection disconnect notifies all active subscribers`() {
    val receivedByA = mutableListOf<DeviceObserverConnectionState>()
    val receivedByB = mutableListOf<DeviceObserverConnectionState>()
    subscribeConnection(receivedByA::add)
    subscribeConnection(receivedByB::add)

    val disconnect = DeviceObserverConnectionState(connected = false, changedAtEpochMs = 42L)
    DeviceWindowObservationSource.publishConnectionState(disconnect)

    assertEquals(listOf(disconnect), receivedByA)
    assertEquals(listOf(disconnect), receivedByB)
  }

  @Test
  fun `cancelled connection subscriber stops receiving`() {
    val received = mutableListOf<DeviceObserverConnectionState>()
    val subscription = subscribeConnection(received::add)

    subscription.cancel()
    DeviceWindowObservationSource.publishConnectionState(
      DeviceObserverConnectionState(connected = true, changedAtEpochMs = 42L),
    )

    assertTrue(received.isEmpty())
  }

  @Test
  fun `expo bridge style subscriber coexists with native subscriber`() {
    // DeviceObserverModule.OnCreate 现在只是普通订阅者之一：
    // bridge 风格订阅（转发 toMap）与另一个 native 订阅者并存，互不覆盖。
    val bridgePayloads = mutableListOf<Map<String, Any?>>()
    val runtimeStates = mutableListOf<DeviceWindowState>()

    subscribeWindow { state -> bridgePayloads.add(state.toMap()) }
    subscribeWindow(runtimeStates::add)

    val state = windowState("com.example.target")
    DeviceWindowObservationSource.publishWindowState(state)

    assertEquals(1, bridgePayloads.size)
    assertEquals(state.packageName, bridgePayloads.single()["packageName"])
    assertEquals(listOf(state), runtimeStates)
  }

  @Test
  fun `cancel is idempotent`() {
    val received = mutableListOf<DeviceWindowState>()
    val subscription = subscribeWindow(received::add)

    subscription.cancel()
    subscription.cancel()
    DeviceWindowObservationSource.publishWindowState(windowState("com.example.target"))

    assertTrue(received.isEmpty())
  }

  @Test
  fun `currentWindowState returns unknown without provider`() {
    DeviceWindowObservationSource.registerSnapshotProvider(null)

    val state = DeviceWindowObservationSource.currentWindowState()

    assertNull(state.packageName)
    assertNull(state.windowId)
    assertEquals("unknown", state.source)
  }

  @Test
  fun `currentWindowState reads registered provider snapshot`() {
    val state = windowState("com.example.target")
    DeviceWindowObservationSource.registerSnapshotProvider { state }

    assertEquals(state, DeviceWindowObservationSource.currentWindowState())
  }

  @Test
  fun `provider unregistration falls back to unknown`() {
    DeviceWindowObservationSource.registerSnapshotProvider { windowState("com.example.target") }

    DeviceWindowObservationSource.registerSnapshotProvider(null)

    assertEquals("unknown", DeviceWindowObservationSource.currentWindowState().source)
  }

  @Test
  fun `provider returning null snapshot falls back to unknown`() {
    DeviceWindowObservationSource.registerSnapshotProvider { null }

    assertEquals("unknown", DeviceWindowObservationSource.currentWindowState().source)
  }

  @Test
  fun `window subscriber A throwing does not interrupt B`() {
    val receivedByB = mutableListOf<DeviceWindowState>()
    subscribeWindow { throw IllegalStateException("listener A crashed") }
    subscribeWindow(receivedByB::add)

    val state = windowState("com.example.target")
    DeviceWindowObservationSource.publishWindowState(state)

    assertEquals(listOf(state), receivedByB)
  }

  @Test
  fun `connection subscriber A throwing does not interrupt B`() {
    val receivedByB = mutableListOf<DeviceObserverConnectionState>()
    subscribeConnection { throw IllegalStateException("listener A crashed") }
    subscribeConnection(receivedByB::add)

    val disconnect = DeviceObserverConnectionState(connected = false, changedAtEpochMs = 42L)
    DeviceWindowObservationSource.publishConnectionState(disconnect)

    assertEquals(listOf(disconnect), receivedByB)
  }

  private fun subscribeWindow(listener: (DeviceWindowState) -> Unit): DeviceWindowObservationSubscription {
    val subscription = DeviceWindowObservationSource.subscribeWindow(listener)
    subscriptions.add(subscription)
    return subscription
  }

  private fun subscribeConnection(
    listener: (DeviceObserverConnectionState) -> Unit,
  ): DeviceWindowObservationSubscription {
    val subscription = DeviceWindowObservationSource.subscribeConnection(listener)
    subscriptions.add(subscription)
    return subscription
  }

  private fun windowState(packageName: String): DeviceWindowState {
    return DeviceWindowState(
      packageName = packageName,
      windowId = 7,
      title = null,
      detectionReliable = true,
      checkedAtEpochMs = 1L,
      source = "accessibility",
    )
  }
}
