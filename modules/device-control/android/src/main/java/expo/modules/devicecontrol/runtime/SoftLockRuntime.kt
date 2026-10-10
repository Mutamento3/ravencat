package expo.modules.devicecontrol.runtime

import expo.modules.devicecontrol.controller.SoftLockController
import expo.modules.devicecontrol.controller.SoftLockControllerDecision
import expo.modules.devicecontrol.controller.SoftLockWindowOwner
import expo.modules.devicecontrol.model.SoftLockCommand
import expo.modules.devicecontrol.model.SoftLockFailure
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockProjection
import expo.modules.devicecontrol.model.SoftLockReconcileResult
import expo.modules.devicecontrol.model.SoftLockRuntimeDiagnostics
import expo.modules.devicecontrol.model.SoftLockRuntimeState
import expo.modules.deviceobserver.DeviceObserverConnectionState
import expo.modules.deviceobserver.DeviceWindowState
import expo.modules.deviceobserver.DeviceWindowObservationSubscription

/**
 * Soft Lock native runtime：active lock 投影 + Device Observer 事实的组合 owner。
 *
 * DC2-E 职责边界：
 * - attach()/detach() 管理 observer 订阅、执行租约 timer 与 blocking window 投影；
 * - reconcile(command) 以 application 业务真值整体替换执行投影；
 * - 不读写 SQLite、不写 Chat、不发通知、不做媒体/AI 决策；
 * - observer 断开或窗口不可靠 → 立即把 desired window 收敛为 detached；
 * - WindowManager 副作用一律在释放 stateLock 后投递到可注入主线程执行器。
 */
interface SoftLockRuntimeHandle {
  fun attach()

  fun detach()

  fun reconcile(command: SoftLockCommand): SoftLockReconcileResult

  fun runtimeState(): SoftLockRuntimeState
}

class SoftLockRuntime(
  private val windowOwner: SoftLockWindowOwner,
  private val mainThreadExecutor: SoftLockMainThreadExecutor,
  private val expiryScheduler: SoftLockExpiryScheduler,
  private val observationSource: DeviceObserverFactSource = NativeDeviceObserverFactSource,
  private val controller: SoftLockController = SoftLockController(),
  private val nowEpochMs: () -> Long = System::currentTimeMillis,
) : SoftLockRuntimeHandle {
  private val stateLock = Any()
  private var windowSubscription: DeviceWindowObservationSubscription? = null
  private var connectionSubscription: DeviceWindowObservationSubscription? = null
  private var runtimeAttached = false
  private var observerConnected = false
  private var currentWindow: DeviceWindowState? = null
  private var projectedLocks: List<SoftLockProjection> = emptyList()
  private var decision = SoftLockControllerDecision(
    matchingLockId = null,
    targetMatched = false,
    shouldBlock = false,
  )
  private var desiredLockId: String? = null
  private var diagnostics = SoftLockRuntimeDiagnostics()

  /**
   * 订阅 Device Observer 事实并读取初始窗口快照；幂等。
   * snapshot provider 只在 observer 连接期间注册，因此快照 source != unknown
   * 即可推出 observer 当前已连接——不依赖 AccessibilityService 实例。
   */
  override fun attach() {
    synchronized(stateLock) {
      if (runtimeAttached) {
        return
      }
      connectionSubscription = observationSource.subscribeConnection(::onConnectionFact)
      windowSubscription = observationSource.subscribeWindow(::onWindowFact)
      runtimeAttached = true

      val snapshot = observationSource.currentWindowState()
      val snapshotIsFact = snapshot.source != UNKNOWN_SOURCE
      observerConnected = snapshotIsFact
      currentWindow = if (snapshotIsFact) snapshot else null
      diagnostics = diagnostics.copy(attachedAtEpochMs = nowEpochMs())
      recomputeDecisionLocked()
    }
    dispatchWindowReconcile()
    dispatchExpirySchedule()
  }

  /**
   * 取消全部订阅并清空运行时事实与投影；幂等。
   * native 不持有业务真值：detach/重启后投影为空，等待 application 重新 reconcile。
   */
  override fun detach() {
    synchronized(stateLock) {
      windowSubscription?.cancel()
      windowSubscription = null
      connectionSubscription?.cancel()
      connectionSubscription = null
      runtimeAttached = false
      observerConnected = false
      currentWindow = null
      projectedLocks = emptyList()
      decision = SoftLockControllerDecision(
        matchingLockId = null,
        targetMatched = false,
        shouldBlock = false,
      )
      desiredLockId = null
      diagnostics = SoftLockRuntimeDiagnostics()
    }
    dispatchWindowReconcile()
    dispatchExpirySchedule()
  }

  /**
   * 权威投影同步：整体替换当前执行投影。
   * ok 只代表投影被接受；实际 window fact 通过 getRuntimeState 单独观察。
   */
  override fun reconcile(command: SoftLockCommand): SoftLockReconcileResult {
    val result = synchronized(stateLock) {
      if (!runtimeAttached) {
        val reason = "device control runtime 尚未 attach"
        diagnostics = diagnostics.copy(
          lastFailure = SoftLockFailure(
            code = SoftLockFailureCode.RUNTIME_UNAVAILABLE,
            message = reason,
          ),
        )
        return SoftLockReconcileResult.runtimeUnavailable(reason)
      }
      projectedLocks = command.activeLocks
      diagnostics = diagnostics.copy(
        lastReconcileAtEpochMs = nowEpochMs(),
        lastFailure = null,
      )
      recomputeDecisionLocked()
      SoftLockReconcileResult.ok(projectedLocks.size)
    }
    dispatchWindowReconcile()
    dispatchExpirySchedule()
    return result
  }

  override fun runtimeState(): SoftLockRuntimeState {
    synchronized(stateLock) {
      val windowState = windowOwner.snapshot()
      return SoftLockRuntimeState(
        runtimeAttached = runtimeAttached,
        observerConnected = observerConnected,
        currentWindow = currentWindow,
        projectedLocks = projectedLocks.toList(),
        matchingLockId = decision.matchingLockId,
        targetMatched = decision.targetMatched,
        shouldBlock = decision.shouldBlock,
        attached = windowState.attached,
        attachedLockId = windowState.attachedLockId,
        overlayStatus = windowState.overlayStatus,
        diagnostics = diagnostics.copy(
          lastFailure = windowState.lastFailure ?: diagnostics.lastFailure,
        ),
      )
    }
  }

  private fun onConnectionFact(state: DeviceObserverConnectionState) {
    synchronized(stateLock) {
      observerConnected = state.connected
      diagnostics = diagnostics.copy(lastConnectionEventAtEpochMs = state.changedAtEpochMs)
      if (state.connected) {
        // connected 事件建立连接事实后立即读取新快照，不能继续沿用断开前的 package。
        currentWindow = observationSource.currentWindowState()
      } else {
        // observer 断开：当前窗口事实立即失效，禁止依赖旧 package 缓存（fail-open 预备）。
        currentWindow = null
      }
      recomputeDecisionLocked()
    }
    dispatchWindowReconcile()
  }

  private fun onWindowFact(state: DeviceWindowState) {
    synchronized(stateLock) {
      // 来自公共 source 的任意 window fact 都证明 observer 当前连接；
      // 窗口是否可用于阻断仍只由 detectionReliable 决定。
      observerConnected = true
      currentWindow = state
      diagnostics = diagnostics.copy(lastWindowEventAtEpochMs = state.checkedAtEpochMs)
      recomputeDecisionLocked()
    }
    dispatchWindowReconcile()
  }

  /** expiry 只让 native 执行投影重新计算，不修改或移除 application projection。 */
  private fun onExpiryReached() {
    synchronized(stateLock) {
      if (!runtimeAttached) {
        return
      }
      recomputeDecisionLocked()
    }
    dispatchWindowReconcile()
    dispatchExpirySchedule()
  }

  private fun recomputeDecisionLocked() {
    decision = controller.reconcile(
      activeLocks = projectedLocks,
      currentWindow = currentWindow,
      observerConnected = observerConnected,
      nowEpochMs = nowEpochMs(),
    )
    desiredLockId = decision.matchingLockId.takeIf { decision.shouldBlock }
  }

  /**
   * runnable 执行时读取最新 desired state；即使多线程 callback 的 post 顺序交错，
   * 旧任务也不会根据过时 package 重新 attach。
   */
  private fun dispatchWindowReconcile() {
    mainThreadExecutor.execute {
      val desired = synchronized(stateLock) { desiredLockId }
      windowOwner.reconcile(desired)
    }
  }

  /** timer 也经同一串行执行器重排，避免并发 reconcile 用旧 expiry 覆盖新租约。 */
  private fun dispatchExpirySchedule() {
    mainThreadExecutor.execute {
      val nextExpiry = synchronized(stateLock) {
        if (!runtimeAttached) {
          null
        } else {
          val now = nowEpochMs()
          projectedLocks.mapNotNull(SoftLockProjection::expiresAtEpochMs)
            .filter { it > now }
            .minOrNull()
        }
      }
      if (nextExpiry == null) {
        expiryScheduler.cancel()
      } else {
        expiryScheduler.schedule(nextExpiry, ::onExpiryReached)
      }
    }
  }

  private companion object {
    const val UNKNOWN_SOURCE = "unknown"
  }
}
