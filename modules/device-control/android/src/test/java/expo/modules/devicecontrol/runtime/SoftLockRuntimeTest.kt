package expo.modules.devicecontrol.runtime

import expo.modules.devicecontrol.controller.SoftLockWindowHost
import expo.modules.devicecontrol.controller.SoftLockWindowOwner
import expo.modules.devicecontrol.model.SoftLockCommand
import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockProjection
import expo.modules.devicecontrol.model.SoftLockReconcileStatus
import expo.modules.deviceobserver.DeviceObserverConnectionState
import expo.modules.deviceobserver.DeviceWindowState
import expo.modules.deviceobserver.DeviceWindowObservationSubscription
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SoftLockRuntimeTest {
  private val source = FakeDeviceObserverFactSource()
  private val windowHost = FakeRuntimeSoftLockWindowHost()
  private val mainThreadExecutor = FakeSoftLockMainThreadExecutor()
  private val expiryScheduler = FakeSoftLockExpiryScheduler()
  private var nowEpochMs = 1000L
  private var permissionGranted = true
  private val runtime = SoftLockRuntime(
    windowOwner = SoftLockWindowOwner(windowHost) { permissionGranted },
    mainThreadExecutor = mainThreadExecutor,
    expiryScheduler = expiryScheduler,
    observationSource = source,
    nowEpochMs = { nowEpochMs },
  )

  @After
  fun tearDown() {
    runtime.detach()
    mainThreadExecutor.runAll()
    source.reset()
  }

  @Test
  fun `reconcile single projection is accepted and stored`() {
    runtime.attach()

    val result = runtime.reconcile(command(lock("lock-1", "com.example.target")))

    assertEquals(SoftLockReconcileStatus.OK, result.status)
    assertEquals(1, result.appliedCount)
    assertEquals(
      listOf("lock-1"),
      runtime.runtimeState().projectedLocks.map(SoftLockProjection::id),
    )
    assertFalse(runtime.runtimeState().attached)
    assertEquals("detached", runtime.runtimeState().overlayStatus.serial)
  }

  @Test
  fun `reconcile multiple projections is accepted`() {
    runtime.attach()

    val result = runtime.reconcile(
      command(
        lock("lock-1", "com.example.first"),
        lock("lock-2", "com.example.second"),
      ),
    )

    assertEquals(SoftLockReconcileStatus.OK, result.status)
    assertEquals(2, result.appliedCount)
    assertEquals(2, runtime.runtimeState().projectedLocks.size)
  }

  @Test
  fun `reconcile empty clears runtime projection`() {
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    val result = runtime.reconcile(SoftLockCommand(emptyList()))

    assertEquals(SoftLockReconcileStatus.OK, result.status)
    assertEquals(0, result.appliedCount)
    assertTrue(runtime.runtimeState().projectedLocks.isEmpty())
    assertFalse(runtime.runtimeState().shouldBlock)
  }

  @Test
  fun `duplicate reconcile is idempotent`() {
    runtime.attach()
    val activeLocks = command(lock("lock-1", "com.example.target"))

    val first = runtime.reconcile(activeLocks)
    val second = runtime.reconcile(activeLocks)

    assertEquals(first.status, second.status)
    assertEquals(first.appliedCount, second.appliedCount)
    assertEquals(
      runtime.runtimeState().projectedLocks,
      runtime.runtimeState().projectedLocks,
    )
    assertEquals(1, runtime.runtimeState().projectedLocks.size)
  }

  @Test
  fun `reconcile before attach returns runtime unavailable`() {
    val result = runtime.reconcile(command(lock("lock-1", "com.example.target")))

    assertEquals(SoftLockReconcileStatus.RUNTIME_UNAVAILABLE, result.status)
    assertEquals("device control runtime 尚未 attach", result.reason)
    assertEquals(result.reason, runtime.runtimeState().diagnostics.lastFailure?.message)
    assertEquals(
      SoftLockFailureCode.RUNTIME_UNAVAILABLE,
      runtime.runtimeState().diagnostics.lastFailure?.code,
    )
  }

  @Test
  fun `currentWindow initial snapshot is read on attach`() {
    source.snapshot = window("com.example.target", reliable = true)

    runtime.attach()

    val state = runtime.runtimeState()
    assertTrue(state.runtimeAttached)
    assertTrue(state.observerConnected)
    assertEquals("com.example.target", state.currentWindow?.packageName)
    // attach 本身不产生窗口事件诊断，快照只作为初始事实。
    assertNull(state.diagnostics.lastWindowEventAtEpochMs)
  }

  @Test
  fun `attach without snapshot starts observer disconnected`() {
    runtime.attach()

    val state = runtime.runtimeState()
    assertTrue(state.runtimeAttached)
    assertFalse(state.observerConnected)
    assertNull(state.currentWindow)
  }

  @Test
  fun `matching target attaches blocking window`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    mainThreadExecutor.runAll()

    val state = runtime.runtimeState()
    assertEquals("lock-1", state.matchingLockId)
    assertTrue(state.targetMatched)
    assertTrue(state.shouldBlock)
    assertTrue(state.attached)
    assertEquals("lock-1", state.attachedLockId)
    assertEquals("attached", state.overlayStatus.serial)
    assertEquals(1, windowHost.addCount)
  }

  @Test
  fun `non target gives shouldBlock false`() {
    source.snapshot = window("com.example.other", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    val state = runtime.runtimeState()
    assertNull(state.matchingLockId)
    assertFalse(state.targetMatched)
    assertFalse(state.shouldBlock)
  }

  @Test
  fun `unreliable window does not become shouldBlock`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    mainThreadExecutor.runAll()

    source.publishWindow(window("com.example.target", reliable = false))
    mainThreadExecutor.runAll()

    val state = runtime.runtimeState()
    assertTrue(state.targetMatched)
    assertFalse(state.shouldBlock)
    assertFalse(state.attached)
    assertEquals(1, windowHost.removeCount)
  }

  @Test
  fun `window fact after reconcile recomputes decision`() {
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    assertFalse(runtime.runtimeState().shouldBlock)

    source.publishWindow(window("com.example.target", reliable = true))
    mainThreadExecutor.runAll()

    assertTrue(runtime.runtimeState().observerConnected)
    assertTrue(runtime.runtimeState().shouldBlock)
    assertTrue(runtime.runtimeState().attached)
  }

  @Test
  fun `initial unknown snapshot then window fact proves observer connected`() {
    runtime.attach()

    assertFalse(runtime.runtimeState().observerConnected)
    assertNull(runtime.runtimeState().currentWindow)

    source.publishWindow(window("com.example.target", reliable = false))

    val state = runtime.runtimeState()
    assertTrue(state.observerConnected)
    assertEquals("com.example.target", state.currentWindow?.packageName)
    // 连接事实与检测可靠性分离：unreliable fact 仍不得触发阻断。
    assertFalse(state.shouldBlock)
  }

  @Test
  fun `observer disconnect updates runtime state`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    mainThreadExecutor.runAll()
    assertTrue(runtime.runtimeState().shouldBlock)

    source.publishConnection(connection(connected = false, changedAtEpochMs = 200L))
    mainThreadExecutor.runAll()

    val state = runtime.runtimeState()
    assertFalse(state.observerConnected)
    // 断开后当前窗口事实立即失效，不保留旧 package 缓存（fail-open 预备）。
    assertNull(state.currentWindow)
    assertFalse(state.shouldBlock)
    assertFalse(state.attached)
    assertEquals(1, windowHost.removeCount)
    assertEquals(200L, state.diagnostics.lastConnectionEventAtEpochMs)
  }

  @Test
  fun `observer reconnect restores facts and decision`() {
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    source.publishConnection(connection(connected = true, changedAtEpochMs = 100L))
    source.publishWindow(window("com.example.target", reliable = true))
    mainThreadExecutor.runAll()
    assertTrue(runtime.runtimeState().shouldBlock)

    source.publishConnection(connection(connected = false, changedAtEpochMs = 200L))
    mainThreadExecutor.runAll()
    assertFalse(runtime.runtimeState().shouldBlock)

    source.snapshot = window("com.example.target", reliable = true)
    source.publishConnection(connection(connected = true, changedAtEpochMs = 300L))
    mainThreadExecutor.runAll()

    assertEquals("com.example.target", runtime.runtimeState().currentWindow?.packageName)
    assertTrue(runtime.runtimeState().shouldBlock)
    assertEquals(2, windowHost.addCount)
  }

  @Test
  fun `runtime detach cancels subscriptions and clears state`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    mainThreadExecutor.runAll()

    runtime.detach()
    mainThreadExecutor.runAll()
    source.publishWindow(window("com.example.target", reliable = true))
    source.publishConnection(connection(connected = false, changedAtEpochMs = 400L))

    val state = runtime.runtimeState()
    assertFalse(state.runtimeAttached)
    assertFalse(state.observerConnected)
    assertNull(state.currentWindow)
    assertTrue(state.projectedLocks.isEmpty())
    assertFalse(state.shouldBlock)
    // 订阅已取消：fake source 不再持有 runtime listener。
    assertTrue(source.windowListeners.isEmpty())
    assertTrue(source.connectionListeners.isEmpty())
  }

  @Test
  fun `detach is idempotent`() {
    runtime.attach()

    runtime.detach()
    runtime.detach()

    assertFalse(runtime.runtimeState().runtimeAttached)
  }

  @Test
  fun `attach is idempotent`() {
    source.snapshot = window("com.example.target", reliable = true)

    runtime.attach()
    runtime.attach()

    assertEquals(1, source.windowListeners.size)
    assertEquals(1, source.connectionListeners.size)
  }

  @Test
  fun `runtime subscription coexists with other subscribers`() {
    val otherWindowFacts = mutableListOf<DeviceWindowState>()
    val otherConnectionFacts = mutableListOf<DeviceObserverConnectionState>()
    source.subscribeWindow(otherWindowFacts::add)
    source.subscribeConnection(otherConnectionFacts::add)

    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    val windowFact = window("com.example.other", reliable = true)
    val connectionFact = connection(connected = true, changedAtEpochMs = 50L)
    source.publishConnection(connectionFact)
    source.publishWindow(windowFact)

    // runtime 与其他订阅者同时收到事实，互不覆盖。
    assertEquals(listOf(windowFact), otherWindowFacts)
    assertEquals(listOf(connectionFact), otherConnectionFacts)
    assertEquals("com.example.other", runtime.runtimeState().currentWindow?.packageName)
    // 其他订阅者与 runtime 各持一个 window 订阅，互不覆盖。
    assertEquals(2, source.windowListeners.size)
    assertEquals(2, source.connectionListeners.size)
  }

  @Test
  fun `ten repeated target facts add only once`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    repeat(10) {
      source.publishWindow(window("com.example.target", reliable = true))
    }
    mainThreadExecutor.runAll()

    assertEquals(1, windowHost.addCount)
  }

  @Test
  fun `projection clear detaches once`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))
    mainThreadExecutor.runAll()

    runtime.reconcile(SoftLockCommand(emptyList()))
    runtime.reconcile(SoftLockCommand(emptyList()))
    mainThreadExecutor.runAll()

    assertFalse(runtime.runtimeState().attached)
    assertEquals(1, windowHost.removeCount)
  }

  @Test
  fun `permission missing never reaches window add`() {
    permissionGranted = false
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    assertEquals(0, windowHost.addCount)
    assertTrue(mainThreadExecutor.pendingCount > 0)

    mainThreadExecutor.runAll()

    assertEquals(0, windowHost.addCount)
    assertFalse(runtime.runtimeState().attached)
    assertEquals("permission_missing", runtime.runtimeState().overlayStatus.serial)
    assertEquals(
      SoftLockFailureCode.OVERLAY_PERMISSION_MISSING,
      runtime.runtimeState().diagnostics.lastFailure?.code,
    )
  }

  @Test
  fun `window operations wait for injected main thread executor`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-1", "com.example.target")))

    assertEquals(0, windowHost.addCount)

    mainThreadExecutor.runAll()

    assertEquals(1, windowHost.addCount)
    assertTrue(mainThreadExecutor.executedCount > 0)
  }

  @Test
  fun `expiry wake detaches without a new window fact`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(
      command(lock("lock-1", "com.example.target", expiresAtEpochMs = 1500L)),
    )
    mainThreadExecutor.runAll()
    assertTrue(runtime.runtimeState().attached)

    nowEpochMs = 1500L
    expiryScheduler.fire()
    mainThreadExecutor.runAll()

    assertFalse(runtime.runtimeState().shouldBlock)
    assertFalse(runtime.runtimeState().attached)
    assertEquals(1, windowHost.removeCount)
    // timer 只收敛 native 执行租约，不删除 application 投影。
    assertEquals(listOf("lock-1"), runtime.runtimeState().projectedLocks.map { it.id })
  }

  @Test
  fun `reconcile schedules nearest future expiry and reschedules replacement`() {
    runtime.attach()
    runtime.reconcile(
      command(
        lock("lock-1", "com.example.first", expiresAtEpochMs = 3000L),
        lock("lock-2", "com.example.second", expiresAtEpochMs = 2000L),
      ),
    )
    mainThreadExecutor.runAll()

    assertEquals(2000L, expiryScheduler.scheduledAtEpochMs)

    runtime.reconcile(
      command(lock("lock-3", "com.example.third", expiresAtEpochMs = 4000L)),
    )
    mainThreadExecutor.runAll()

    assertEquals(4000L, expiryScheduler.scheduledAtEpochMs)
    assertTrue(expiryScheduler.cancelCount >= 1)
  }

  @Test
  fun `runtime detach cancels expiry schedule`() {
    runtime.attach()
    runtime.reconcile(
      command(lock("lock-1", "com.example.target", expiresAtEpochMs = 2000L)),
    )
    mainThreadExecutor.runAll()
    assertEquals(2000L, expiryScheduler.scheduledAtEpochMs)

    runtime.detach()
    mainThreadExecutor.runAll()

    assertNull(expiryScheduler.scheduledAtEpochMs)
    assertTrue(expiryScheduler.cancelCount >= 1)
  }

  @Test
  fun `matching owner switch removes old before adding new`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(command(lock("lock-a", "com.example.target")))
    mainThreadExecutor.runAll()

    runtime.reconcile(command(lock("lock-b", "com.example.target")))
    mainThreadExecutor.runAll()

    assertEquals(listOf("add:lock-a", "remove", "add:lock-b"), windowHost.operations)
    assertEquals("lock-b", runtime.runtimeState().attachedLockId)
  }

  @Test
  fun `expired projection does not match even with matching window`() {
    source.snapshot = window("com.example.target", reliable = true)
    runtime.attach()
    runtime.reconcile(
      command(lock("lock-1", "com.example.target", expiresAtEpochMs = 500L)),
    )

    val state = runtime.runtimeState()
    assertNull(state.matchingLockId)
    assertFalse(state.shouldBlock)
  }

  private fun command(vararg locks: SoftLockProjection): SoftLockCommand {
    return SoftLockCommand(locks.toList())
  }

  private fun lock(
    id: String,
    targetPackage: String,
    expiresAtEpochMs: Long? = null,
  ): SoftLockProjection {
    return SoftLockProjection(
      id = id,
      targetPackage = targetPackage,
      expiresAtEpochMs = expiresAtEpochMs,
    )
  }

  private fun window(packageName: String?, reliable: Boolean): DeviceWindowState {
    return DeviceWindowState(
      packageName = packageName,
      windowId = 7,
      title = null,
      detectionReliable = reliable,
      checkedAtEpochMs = 100L,
      source = if (reliable) "accessibility" else "unknown",
    )
  }

  private fun connection(connected: Boolean, changedAtEpochMs: Long): DeviceObserverConnectionState {
    return DeviceObserverConnectionState(
      connected = connected,
      changedAtEpochMs = changedAtEpochMs,
    )
  }
}

/** 只镜像 Device Observer 公共 contract 的可控 fake；不触碰真实事件源。 */
private class FakeDeviceObserverFactSource : DeviceObserverFactSource {
  val windowListeners = mutableListOf<(DeviceWindowState) -> Unit>()
  val connectionListeners = mutableListOf<(DeviceObserverConnectionState) -> Unit>()
  var snapshot: DeviceWindowState? = null

  override fun subscribeWindow(
    listener: (DeviceWindowState) -> Unit,
  ): DeviceWindowObservationSubscription {
    windowListeners.add(listener)
    return DeviceWindowObservationSubscription { windowListeners.remove(listener) }
  }

  override fun subscribeConnection(
    listener: (DeviceObserverConnectionState) -> Unit,
  ): DeviceWindowObservationSubscription {
    connectionListeners.add(listener)
    return DeviceWindowObservationSubscription { connectionListeners.remove(listener) }
  }

  override fun currentWindowState(): DeviceWindowState {
    return snapshot ?: DeviceWindowState.unknown()
  }

  fun publishWindow(state: DeviceWindowState) {
    windowListeners.toList().forEach { it(state) }
  }

  fun publishConnection(state: DeviceObserverConnectionState) {
    connectionListeners.toList().forEach { it(state) }
  }

  fun reset() {
    windowListeners.clear()
    connectionListeners.clear()
    snapshot = null
  }
}

private class FakeSoftLockMainThreadExecutor : SoftLockMainThreadExecutor {
  private val pending = ArrayDeque<() -> Unit>()
  var executedCount = 0
    private set

  val pendingCount: Int
    get() = pending.size

  override fun execute(action: () -> Unit) {
    pending.addLast(action)
  }

  fun runAll() {
    while (pending.isNotEmpty()) {
      executedCount += 1
      pending.removeFirst().invoke()
    }
  }
}

private class FakeSoftLockExpiryScheduler : SoftLockExpiryScheduler {
  var scheduledAtEpochMs: Long? = null
    private set
  var cancelCount = 0
    private set
  private var callback: (() -> Unit)? = null

  override fun schedule(expiresAtEpochMs: Long, onExpiry: () -> Unit) {
    if (callback != null) {
      cancelCount += 1
    }
    scheduledAtEpochMs = expiresAtEpochMs
    callback = onExpiry
  }

  override fun cancel() {
    cancelCount += 1
    scheduledAtEpochMs = null
    callback = null
  }

  fun fire() {
    val pendingCallback = checkNotNull(callback)
    scheduledAtEpochMs = null
    callback = null
    pendingCallback()
  }
}

private class FakeRuntimeSoftLockWindowHost : SoftLockWindowHost {
  val operations = mutableListOf<String>()

  val addCount: Int
    get() = operations.count { it.startsWith("add:") }

  val removeCount: Int
    get() = operations.count { it == "remove" }

  override fun add(lockId: String, onFailure: (SoftLockFailure) -> Unit) {
    operations.add("add:$lockId")
  }

  override fun remove() {
    operations.add("remove")
  }
}
