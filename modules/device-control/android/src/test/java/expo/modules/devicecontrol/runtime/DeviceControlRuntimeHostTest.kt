package expo.modules.devicecontrol.runtime

import expo.modules.devicecontrol.model.DeviceControlRuntimeStartStatus
import expo.modules.devicecontrol.model.DeviceControlRuntimeStopStatus
import expo.modules.devicecontrol.model.SoftLockCommand
import expo.modules.devicecontrol.model.SoftLockFailureCode
import expo.modules.devicecontrol.model.SoftLockProjection
import expo.modules.devicecontrol.model.SoftLockReconcileResult
import expo.modules.devicecontrol.model.SoftLockRuntimeState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceControlRuntimeHostTest {
  @Test
  fun `repeated bridge start creates one runtime and one expiry owner`() {
    var runtimeCreationCount = 0
    var serviceStartCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost {
      runtimeCreationCount += 1
      runtime
    }
    val requester = DeviceControlServiceStartRequester { _ ->
      serviceStartCount += 1
      DeviceControlServiceStartRequestResult.Accepted
    }

    val first = host.startRuntime(requester)
    val afterBridgeRecreate = host.startRuntime(requester)

    assertEquals(DeviceControlRuntimeStartStatus.STARTED, first.status)
    assertEquals(DeviceControlRuntimeStartStatus.ALREADY_RUNNING, afterBridgeRecreate.status)
    assertEquals(1, runtimeCreationCount)
    assertEquals(1, serviceStartCount)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
    assertFalse(host.runtimeState().serviceRunning)
  }

  @Test
  fun `running service bypasses background first start restriction`() {
    var serviceStartCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    startAndPromote(host)

    val result = host.startRuntime {
      serviceStartCount += 1
      DeviceControlServiceStartRequestResult.BackgroundRestricted("不得进入 cold start")
    }

    assertEquals(DeviceControlRuntimeStartStatus.ALREADY_RUNNING, result.status)
    assertEquals(0, serviceStartCount)
    assertTrue(host.runtimeState().serviceRunning)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `service start callback is idempotent and keeps the same runtime`() {
    var runtimeCreationCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost {
      runtimeCreationCount += 1
      runtime
    }

    var serviceGeneration: Long? = null
    host.startRuntime { generation ->
      serviceGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }
    host.onServiceStarted(requireNotNull(serviceGeneration))
    host.onServiceStarted(requireNotNull(serviceGeneration))

    assertEquals(1, runtimeCreationCount)
    assertTrue(host.runtimeState().serviceRunning)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `background start restriction detaches host and returns typed failure`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }

    val result = host.startRuntime {
      DeviceControlServiceStartRequestResult.BackgroundRestricted("background restricted")
    }

    assertEquals(DeviceControlRuntimeStartStatus.BACKGROUND_START_RESTRICTED, result.status)
    assertFalse(host.runtimeState().serviceRunning)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
    assertTrue(host.runtimeState().softLock.projectedLocks.isEmpty())
    assertFalse(host.runtimeState().softLock.attached)
    assertEquals(1, runtime.detachCount)
    assertEquals(
      SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
      host.runtimeState().softLock.diagnostics.lastFailure?.code,
    )
  }

  @Test
  fun `generic start failure detaches host`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }

    val result = host.startRuntime {
      DeviceControlServiceStartRequestResult.Failed("start failed")
    }

    assertEquals(DeviceControlRuntimeStartStatus.FAILED, result.status)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
    assertEquals(1, runtime.detachCount)
    assertEquals(
      SoftLockFailureCode.SERVICE_START_FAILED,
      host.runtimeState().softLock.diagnostics.lastFailure?.code,
    )
  }

  @Test
  fun `background restricted service promotion stays typed until destroy`() {
    var serviceStartCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    var serviceGeneration: Long? = null
    host.startRuntime { generation ->
      serviceGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }

    host.onServicePromotionFailed(
      serviceGeneration = requireNotNull(serviceGeneration),
      code = SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
      reason = "promotion restricted",
    )
    val whileStopping = host.startRuntime {
      serviceStartCount += 1
      DeviceControlServiceStartRequestResult.Accepted
    }

    assertEquals(
      DeviceControlRuntimeStartStatus.BACKGROUND_START_RESTRICTED,
      whileStopping.status,
    )
    assertEquals("promotion restricted", whileStopping.reason)
    assertEquals(0, serviceStartCount)
    assertFalse(host.runtimeState().serviceRunning)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
    assertEquals(
      SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
      host.runtimeState().softLock.diagnostics.lastFailure?.code,
    )

    host.onServiceDestroyed(requireNotNull(serviceGeneration))
    val afterDestroy = host.startRuntime {
      serviceStartCount += 1
      DeviceControlServiceStartRequestResult.Accepted
    }

    assertEquals(DeviceControlRuntimeStartStatus.STARTED, afterDestroy.status)
    assertEquals(1, serviceStartCount)
  }

  @Test
  fun `generic service promotion failure is not background restriction`() {
    var serviceStartCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    var serviceGeneration: Long? = null
    host.startRuntime { generation ->
      serviceGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }

    host.onServicePromotionFailed(
      serviceGeneration = requireNotNull(serviceGeneration),
      code = SoftLockFailureCode.SERVICE_START_FAILED,
      reason = "promotion failed",
    )
    val result = host.startRuntime {
      serviceStartCount += 1
      DeviceControlServiceStartRequestResult.BackgroundRestricted("wrong path")
    }

    assertEquals(DeviceControlRuntimeStartStatus.FAILED, result.status)
    assertEquals("promotion failed", result.reason)
    assertEquals(0, serviceStartCount)
    assertFalse(host.runtimeState().serviceRunning)
    assertEquals(
      SoftLockFailureCode.SERVICE_START_FAILED,
      host.runtimeState().softLock.diagnostics.lastFailure?.code,
    )
  }

  @Test
  fun `runtime attach failure is returned as typed start failure`() {
    val runtime = object : SoftLockRuntimeHandle by FakeHostSoftLockRuntime() {
      override fun attach() {
        throw IllegalStateException("attach failed")
      }
    }
    val host = DeviceControlRuntimeHost { runtime }

    val result = host.startRuntime { DeviceControlServiceStartRequestResult.Accepted }

    assertEquals(DeviceControlRuntimeStartStatus.FAILED, result.status)
    assertEquals("attach failed", result.reason)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `service destroy clears projection and detaches runtime`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    val serviceGeneration = startAndPromote(host)
    host.reconcile(command(lock("lock-1")))

    host.onServiceDestroyed(serviceGeneration)

    assertFalse(host.runtimeState().serviceRunning)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
    assertTrue(host.runtimeState().softLock.projectedLocks.isEmpty())
  }

  @Test
  fun `service takeover does not rewrite authoritative projection`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    var serviceGeneration: Long? = null
    host.startRuntime { generation ->
      serviceGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }
    host.reconcile(command(lock("lock-1")))

    host.onServiceStarted(requireNotNull(serviceGeneration))

    assertEquals(
      listOf("lock-1"),
      host.runtimeState().softLock.projectedLocks.map(SoftLockProjection::id),
    )
  }

  @Test
  fun `empty projection detaches before service stop`() {
    val operations = mutableListOf<String>()
    val runtime = FakeHostSoftLockRuntime(operations)
    val host = DeviceControlRuntimeHost { runtime }
    startAndPromote(host)
    operations.clear()

    val result = host.stopRuntimeIfIdle {
      operations.add("stop_service")
      true
    }

    assertEquals(DeviceControlRuntimeStopStatus.STOPPED, result.status)
    assertEquals(listOf("detach_runtime", "stop_service"), operations)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `rejected stop restores old service ownership`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    startAndPromote(host)

    val stopResult = host.stopRuntimeIfIdle { false }
    var restartRequestCount = 0
    val restartResult = host.startRuntime {
      restartRequestCount += 1
      DeviceControlServiceStartRequestResult.Accepted
    }

    assertEquals(DeviceControlRuntimeStopStatus.FAILED, stopResult.status)
    assertEquals(DeviceControlRuntimeStartStatus.ALREADY_RUNNING, restartResult.status)
    assertEquals(0, restartRequestCount)
    assertTrue(host.runtimeState().serviceRunning)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `throwing stop restores old service ownership`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    startAndPromote(host)

    val stopResult = host.stopRuntimeIfIdle {
      throw IllegalStateException("stop failed")
    }
    var restartRequestCount = 0
    val restartResult = host.startRuntime {
      restartRequestCount += 1
      DeviceControlServiceStartRequestResult.Accepted
    }

    assertEquals(DeviceControlRuntimeStopStatus.FAILED, stopResult.status)
    assertEquals("stop failed", stopResult.reason)
    assertEquals(DeviceControlRuntimeStartStatus.ALREADY_RUNNING, restartResult.status)
    assertEquals(0, restartRequestCount)
    assertTrue(host.runtimeState().serviceRunning)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `late start callback from stopping generation is rejected`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    var oldGeneration: Long? = null
    host.startRuntime { generation ->
      oldGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }

    val stopResult = host.stopRuntimeIfIdle { true }
    val accepted = host.onServiceStarted(requireNotNull(oldGeneration))

    assertEquals(DeviceControlRuntimeStopStatus.STOPPED, stopResult.status)
    assertFalse(accepted)
    assertFalse(host.ownsServiceGeneration(requireNotNull(oldGeneration)))
    assertFalse(host.runtimeState().serviceRunning)
    assertFalse(host.runtimeState().softLock.runtimeAttached)
  }

  @Test
  fun `non empty projection refuses to stop service`() {
    var stopRequestCount = 0
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    startAndPromote(host)
    host.reconcile(command(lock("lock-1")))

    val result = host.stopRuntimeIfIdle {
      stopRequestCount += 1
      true
    }

    assertEquals(DeviceControlRuntimeStopStatus.STILL_ACTIVE, result.status)
    assertEquals(1, result.activeProjectionCount)
    assertEquals(0, stopRequestCount)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
    assertTrue(host.runtimeState().serviceRunning)
  }

  @Test
  fun `service lifecycle does not create an incremental projection path`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }

    startAndPromote(host)

    assertTrue(host.runtimeState().softLock.projectedLocks.isEmpty())
    assertEquals(0, runtime.reconcileCount)
  }

  @Test
  fun `accepted stop relinquishes service ownership before destroy`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    val serviceGeneration = startAndPromote(host)

    val result = host.stopRuntimeIfIdle { true }

    assertEquals(DeviceControlRuntimeStopStatus.STOPPED, result.status)
    assertFalse(host.runtimeState().serviceRunning)
    assertFalse(host.runtimeState().softLock.runtimeAttached)

    host.onServiceDestroyed(serviceGeneration)

    assertFalse(host.runtimeState().serviceRunning)
  }

  @Test
  fun `old service destroy cannot detach a newer runtime generation`() {
    val runtime = FakeHostSoftLockRuntime()
    val host = DeviceControlRuntimeHost { runtime }
    val oldGeneration = startAndPromote(host)

    val stopResult = host.stopRuntimeIfIdle { true }
    var newGeneration: Long? = null
    val restartResult = host.startRuntime { generation ->
      newGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }
    host.onServiceStarted(requireNotNull(newGeneration))
    host.reconcile(command(lock("new-lock")))

    host.onServicePromotionFailed(
      serviceGeneration = oldGeneration,
      code = SoftLockFailureCode.BACKGROUND_START_RESTRICTED,
      reason = "stale promotion failure",
    )
    host.onServiceDestroyed(oldGeneration)

    assertEquals(DeviceControlRuntimeStopStatus.STOPPED, stopResult.status)
    assertEquals(DeviceControlRuntimeStartStatus.STARTED, restartResult.status)
    assertTrue(host.runtimeState().serviceRunning)
    assertTrue(host.runtimeState().softLock.runtimeAttached)
    assertEquals(
      listOf("new-lock"),
      host.runtimeState().softLock.projectedLocks.map(SoftLockProjection::id),
    )
  }

  @Test
  fun `fresh process host has no projection and does not create runtime`() {
    val oldRuntime = FakeHostSoftLockRuntime()
    val oldHost = DeviceControlRuntimeHost { oldRuntime }
    val serviceGeneration = startAndPromote(oldHost)
    oldHost.reconcile(command(lock("lock-before-process-loss")))
    oldHost.onServiceDestroyed(serviceGeneration)

    var newRuntimeCreationCount = 0
    val newHost = DeviceControlRuntimeHost {
      newRuntimeCreationCount += 1
      FakeHostSoftLockRuntime()
    }

    val state = newHost.runtimeState()

    assertFalse(state.serviceRunning)
    assertFalse(state.softLock.runtimeAttached)
    assertTrue(state.softLock.projectedLocks.isEmpty())
    assertFalse(state.softLock.attached)
    assertEquals(0, newRuntimeCreationCount)
  }

  private fun startAndPromote(host: DeviceControlRuntimeHost): Long {
    var serviceGeneration: Long? = null
    val result = host.startRuntime { generation ->
      serviceGeneration = generation
      DeviceControlServiceStartRequestResult.Accepted
    }
    val generation = requireNotNull(serviceGeneration)
    host.onServiceStarted(generation)
    assertEquals(DeviceControlRuntimeStartStatus.STARTED, result.status)
    return generation
  }

  private fun command(vararg locks: SoftLockProjection): SoftLockCommand {
    return SoftLockCommand(locks.toList())
  }

  private fun lock(id: String): SoftLockProjection {
    return SoftLockProjection(
      id = id,
      targetPackage = "com.example.target",
      expiresAtEpochMs = null,
    )
  }
}

private class FakeHostSoftLockRuntime(
  private val operations: MutableList<String> = mutableListOf(),
) : SoftLockRuntimeHandle {
  private var attached = false
  private var projectedLocks = emptyList<SoftLockProjection>()
  var detachCount = 0
    private set
  var reconcileCount = 0
    private set

  override fun attach() {
    attached = true
  }

  override fun detach() {
    operations.add("detach_runtime")
    detachCount += 1
    attached = false
    projectedLocks = emptyList()
  }

  override fun reconcile(command: SoftLockCommand): SoftLockReconcileResult {
    reconcileCount += 1
    projectedLocks = command.activeLocks
    return SoftLockReconcileResult.ok(projectedLocks.size)
  }

  override fun runtimeState(): SoftLockRuntimeState {
    return SoftLockRuntimeState.detached().copy(
      runtimeAttached = attached,
      projectedLocks = projectedLocks,
    )
  }
}
