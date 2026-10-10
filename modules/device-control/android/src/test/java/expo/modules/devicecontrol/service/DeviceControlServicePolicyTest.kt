package expo.modules.devicecontrol.service

import android.app.Service
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceControlServicePolicyTest {
  @Test
  fun `service is explicitly non sticky`() {
    assertEquals(Service.START_NOT_STICKY, DeviceControlService.START_MODE)
  }

  @Test
  fun `each generation stops only its immutable Android start id`() {
    val stoppedStartIds = mutableListOf<Int>()
    val first = DeviceControlServiceStartOwnership(
      serviceGeneration = 1L,
      startId = 10,
      stopSelf = stoppedStartIds::add,
    )
    val second = DeviceControlServiceStartOwnership(
      serviceGeneration = 2L,
      startId = 11,
      stopSelf = stoppedStartIds::add,
    )

    assertFalse(first.requestStop(2L))
    assertTrue(first.requestStop(1L))
    assertTrue(second.requestStop(2L))
    assertEquals(listOf(10, 11), stoppedStartIds)
  }

  @Test
  fun `stale intent cannot overwrite same instance destroy ownership`() {
    val ownership = DeviceControlServiceInstanceOwnership()
    val ownsGeneration: (Long) -> Boolean = { generation -> generation == 2L }

    assertTrue(ownership.accept(2L, ownsGeneration))
    assertFalse(ownership.accept(1L, ownsGeneration))
    assertEquals(2L, ownership.generationForDestroy())
  }

  @Test
  fun `old start id stop cannot take ownership from newer start on same instance`() {
    val stoppedStartIds = mutableListOf<Int>()
    val instanceOwnership = DeviceControlServiceInstanceOwnership()
    var activeGeneration = 1L
    val ownsActiveGeneration: (Long) -> Boolean = { generation ->
      generation == activeGeneration
    }

    assertTrue(instanceOwnership.accept(1L, ownsActiveGeneration))
    val oldStopOwner = DeviceControlServiceStartOwnership(
      serviceGeneration = 1L,
      startId = 10,
      stopSelf = stoppedStartIds::add,
    )

    activeGeneration = 2L
    assertTrue(instanceOwnership.accept(2L, ownsActiveGeneration))
    val newStopOwner = DeviceControlServiceStartOwnership(
      serviceGeneration = 2L,
      startId = 11,
      stopSelf = stoppedStartIds::add,
    )

    assertTrue(oldStopOwner.requestStop(1L))
    assertEquals(listOf(10), stoppedStartIds)
    assertEquals(2L, instanceOwnership.generationForDestroy())

    assertTrue(newStopOwner.requestStop(2L))
    assertEquals(listOf(10, 11), stoppedStartIds)
  }
}
