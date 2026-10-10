package expo.modules.callruntime

import org.junit.Assert.*
import org.junit.Test

class CallAudioRouteControllerTest {
  private val earpiece = CallAudioDevice(1, "earpiece")
  private val speaker = CallAudioDevice(2, "speaker")
  private val headset = CallAudioDevice(3, "headset")

  private inner class SystemAudio(var devices: List<CallAudioDevice>, var actual: CallAudioDevice?) {
    var accepted = true
    val requests = mutableListOf<Int>()
    var timeout: (() -> Unit)? = null
    val controller = CallAudioRouteController(
      "call-1", { devices }, { actual },
      { id -> requests.add(id); accepted },
      { task -> timeout = task; val cancel: () -> Unit = { timeout = null }; cancel },
      {},
    )
    fun acknowledge(device: CallAudioDevice) {
      actual = device
      controller.actualChanged()
    }
    fun select(route: String) {
      controller.select(route) {}
      acknowledge(devices.first { it.route == route })
    }
  }

  @Test fun `without headset defaults to earpiece and offers two routes`() {
    val system = SystemAudio(listOf(earpiece, speaker), speaker)
    var finished = false
    system.controller.begin { assertNull(it); finished = true }
    assertEquals(listOf(1), system.requests)
    assertFalse(finished)
    assertEquals("speaker", system.controller.snapshot()["route"])
    system.acknowledge(earpiece)
    assertTrue(finished)
    assertEquals(listOf("earpiece", "speaker"), system.controller.snapshot()["availableRoutes"])
  }

  @Test fun `headset at call start wins and waits for actual device`() {
    val system = SystemAudio(listOf(earpiece, speaker, headset), earpiece)
    var finished = false
    system.controller.begin { assertNull(it); finished = true }
    assertEquals(listOf(3), system.requests)
    assertEquals("earpiece", system.controller.snapshot()["route"])
    assertEquals("headset", system.controller.snapshot()["pendingRoute"])
    assertFalse(finished)
    system.acknowledge(speaker)
    assertFalse(finished)
    system.acknowledge(headset)
    assertTrue(finished)
    assertNull(system.timeout)
    assertEquals(listOf("earpiece", "speaker", "headset"), system.controller.snapshot()["availableRoutes"])
  }

  @Test fun `synchronously applied request completes from system readback`() {
    val controller = CallAudioRouteController("call", { listOf(earpiece, speaker) }, { earpiece }, { true }, { error("No timeout needed") }, {})
    var finished = false
    controller.begin { assertNull(it); finished = true }
    assertTrue(finished)
  }

  @Test fun `rejected and timed out requests keep actual route and expose failure`() {
    val system = SystemAudio(listOf(earpiece, speaker), earpiece)
    system.accepted = false
    var failure: String? = null
    system.controller.select("speaker") { failure = it }
    assertNotNull(failure)
    assertEquals("earpiece", system.controller.snapshot()["route"])
    assertNull(system.controller.snapshot()["pendingRoute"])
    system.accepted = true
    failure = null
    system.controller.select("speaker") { failure = it }
    system.timeout!!.invoke()
    assertNotNull(failure)
    assertEquals("earpiece", system.controller.snapshot()["route"])
    assertNotNull(system.controller.snapshot()["errorMessage"])
    system.acknowledge(speaker)
    assertEquals("speaker", system.controller.snapshot()["route"])
  }

  @Test fun `new headset selects once and subsequent callbacks preserve manual speaker`() {
    val system = SystemAudio(listOf(earpiece, speaker), earpiece)
    system.controller.begin {}
    system.devices = listOf(earpiece, speaker, headset)
    system.controller.devicesChanged()
    assertEquals(listOf(1, 3), system.requests)
    system.acknowledge(headset)
    system.select("speaker")
    repeat(3) { system.controller.devicesChanged(); system.controller.actualChanged() }
    assertEquals(listOf(1, 3, 2), system.requests)
    assertEquals("speaker", system.controller.snapshot()["route"])
  }

  @Test fun `headset unplug returns to earpiece regardless of callback order`() {
    for (actualCallbackFirst in listOf(false, true)) {
      val system = SystemAudio(listOf(earpiece, speaker, headset), headset)
      system.controller.begin {}
      system.devices = listOf(earpiece, speaker)
      if (actualCallbackFirst) system.acknowledge(speaker)
      system.controller.devicesChanged()
      assertEquals(listOf(3, 1), system.requests)
      system.acknowledge(earpiece)
      assertEquals("earpiece", system.controller.snapshot()["route"])
    }
  }

  @Test fun `unplug does not replace a manually selected speaker`() {
    val system = SystemAudio(listOf(earpiece, speaker, headset), headset)
    system.controller.begin {}
    system.select("speaker")
    system.devices = listOf(earpiece, speaker)
    system.controller.devicesChanged()
    assertEquals(listOf(3, 2), system.requests)
    assertEquals("speaker", system.controller.snapshot()["route"])
  }

  @Test fun `new headset replaces previous headset and survives manual route roundtrip`() {
    val system = SystemAudio(listOf(earpiece, speaker, headset), headset)
    system.controller.begin {}
    val wired = CallAudioDevice(4, "headset")
    system.devices = listOf(earpiece, speaker, headset, wired)
    system.controller.devicesChanged()
    assertEquals(listOf(3, 4), system.requests)
    system.acknowledge(wired)
    system.select("speaker")
    system.controller.select("headset") {}
    assertEquals(4, system.requests.last())
    system.acknowledge(wired)
  }

  @Test fun `failed unplug fallback is not repeated by unrelated callbacks`() {
    val system = SystemAudio(listOf(earpiece, speaker, headset), headset)
    system.controller.begin {}
    system.accepted = false
    system.devices = listOf(earpiece, speaker)
    system.acknowledge(speaker)
    repeat(3) { system.controller.devicesChanged() }
    assertEquals(listOf(3, 1), system.requests)
    assertEquals("speaker", system.controller.snapshot()["route"])
    assertNotNull(system.controller.snapshot()["errorMessage"])
  }

  @Test fun `new headset during switch queues one automatic selection`() {
    val system = SystemAudio(listOf(earpiece, speaker), earpiece)
    var finished = false
    system.controller.select("speaker") { assertNull(it); finished = true }
    system.devices = listOf(earpiece, speaker, headset)
    system.controller.devicesChanged()
    assertFalse(finished)
    system.acknowledge(speaker)
    assertTrue(finished)
    assertEquals(listOf(2, 3), system.requests)
    system.acknowledge(headset)
    assertEquals("headset", system.controller.snapshot()["route"])
  }

  @Test fun `parallel selection and unavailable headset do not fabricate success`() {
    val system = SystemAudio(listOf(earpiece, speaker), earpiece)
    system.controller.select("headset") { assertNotNull(it) }
    assertTrue(system.requests.isEmpty())
    system.controller.select("speaker") {}
    system.controller.select("earpiece") { assertNotNull(it) }
    assertEquals(listOf(2), system.requests)
  }

  @Test fun `session close cancels pending request and late callbacks`() {
    val system = SystemAudio(listOf(earpiece, speaker, headset), earpiece)
    var completed = 0
    system.controller.begin { assertNotNull(it); completed += 1 }
    val timeout = system.timeout!!
    system.controller.close()
    assertNull(system.timeout)
    val snapshot = system.controller.snapshot()
    system.acknowledge(headset)
    timeout()
    assertEquals(1, completed)
    assertEquals(snapshot, system.controller.snapshot())
  }

  @Test fun `asynchronous telecom rejection leaves actual route and ignores old failure`() {
    val system = SystemAudio(listOf(earpiece, speaker), earpiece)
    var error: String? = null
    system.controller.select("speaker") { error = it }
    system.controller.requestFailed(2, "系统拒绝")
    assertEquals("系统拒绝", error)
    assertEquals("earpiece", system.controller.snapshot()["route"])
    assertNull(system.controller.snapshot()["pendingRoute"])
    assertNull(system.timeout)
    system.controller.select("earpiece") {}
    val snapshot = system.controller.snapshot()
    system.controller.requestFailed(2, "旧请求失败")
    assertEquals(snapshot, system.controller.snapshot())
  }
}
