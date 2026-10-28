package expo.modules.callruntime

import com.facebook.react.bridge.BridgeReactContext
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CallExecutionRegistryTest {
  private lateinit var service: CallExecutionService

  @Before fun setup() {
    service = Robolectric.buildService(CallExecutionService::class.java).create().get()
    CallExecutionRegistry.host = service
    CallExecutionRegistry.callId = "old-call"
    CallExecutionRegistry.alive = true
    CallExecutionRegistry.ready = CompletableDeferred()
    CallExecutionRegistry.released = CompletableDeferred()
    CallExecutionRegistry.emit = null
  }

  @After fun cleanup() {
    service.scope.cancel()
    CallExecutionRegistry.host = null
    CallExecutionRegistry.callId = null
    CallExecutionRegistry.alive = false
    CallExecutionRegistry.executionContext = null
    CallExecutionRegistry.ready = CompletableDeferred()
    CallExecutionRegistry.released = CompletableDeferred(Unit)
    CallExecutionRegistry.emit = null
  }

  @Test fun `release failure survives service destruction`() = runBlocking {
    val failure = IllegalStateException("系统断开失败")
    val completion = CallExecutionRegistry.released
    CallExecutionRegistry.cancelled(service, failure)
    assertEquals(failure.message, runCatching { completion.await() }.exceptionOrNull()!!.message)
    assertNull(CallExecutionRegistry.host)
    assertFalse(CallExecutionRegistry.alive)
  }

  @Test fun `old cancellation is published before a new call can take ownership`() {
    val completion = CallExecutionRegistry.released
    val nextReady = CompletableDeferred<Unit>()
    val cancelled = mutableListOf<String>()
    CallExecutionRegistry.emit = { event, data ->
      assertEquals("onCancelled", event)
      cancelled.add(data["callId"] as String)
    }
    // 模拟等待释放的新 start 同步恢复并取得下一通电话的身份。
    completion.invokeOnCompletion {
      CallExecutionRegistry.callId = "next-call"
      CallExecutionRegistry.alive = true
      CallExecutionRegistry.ready = nextReady
    }
    CallExecutionRegistry.cancelled(service, null)
    assertEquals(listOf("old-call"), cancelled)
    assertEquals("next-call", CallExecutionRegistry.callId)
    assertTrue(CallExecutionRegistry.alive)
    assertFalse(nextReady.isCompleted)
  }

  @Test fun `destruction of an old service cannot release a different call`() {
    val oldService = Robolectric.buildService(CallExecutionService::class.java).create().get()
    val completion = CallExecutionRegistry.released
    try {
      CallExecutionRegistry.cancelled(oldService, null)
      assertSame(service, CallExecutionRegistry.host)
      assertFalse(completion.isCompleted)
      assertTrue(CallExecutionRegistry.alive)
    } finally { oldService.scope.cancel() }
  }

  @Test fun `late start cannot recreate an ended call`() = runBlocking {
    CallExecutionRegistry.alive = false
    val context = BridgeReactContext(RuntimeEnvironment.getApplication())
    val failure = runCatching {
      CallExecutionRegistry.start(context, mapOf("callId" to "old-call"))
    }.exceptionOrNull()
    assertEquals("通话已经结束", failure!!.message)
    assertSame(service, CallExecutionRegistry.host)
  }
}
