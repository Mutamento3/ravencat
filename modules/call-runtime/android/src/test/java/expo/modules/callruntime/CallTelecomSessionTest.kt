package expo.modules.callruntime

import android.os.ParcelUuid
import android.telecom.DisconnectCause
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallEndpointCompat
import androidx.core.telecom.CallException
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.coroutines.CoroutineContext

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class CallTelecomSessionTest {
  /** 只替代系统回执；激活期限、释放与迟到句柄处理全部运行产品 owner。 */
  private class SystemCall(override val coroutineContext: CoroutineContext) : CallControlScope {
    val registration = CompletableDeferred<Unit>().apply { complete(Unit) }
    var registrationWait: Deferred<Unit> = registration
    val disconnected = CompletableDeferred<Unit>()
    var disconnectWait: Deferred<Unit> = CompletableDeferred(Unit)
    var disconnectResult: CallControlResult = CallControlResult.Success()
    var disconnects = 0
    var registrations = 0
    var connectResult: CallControlResult = CallControlResult.Success()
    override val currentCallEndpoint = MutableSharedFlow<CallEndpointCompat>()
    override val availableEndpoints = MutableSharedFlow<List<CallEndpointCompat>>()
    override val isMuted = MutableSharedFlow<Boolean>()
    override fun getCallId(): ParcelUuid = error("这些场景不读取系统身份")
    override suspend fun setActive(): CallControlResult = connectResult
    override suspend fun answer(callType: Int): CallControlResult = connectResult
    override suspend fun setInactive(): CallControlResult = error("这些场景不保持通话")
    override suspend fun requestEndpointChange(endpoint: CallEndpointCompat): CallControlResult = CallControlResult.Success()
    override suspend fun disconnect(disconnectCause: DisconnectCause): CallControlResult {
      disconnects++
      disconnectWait.await()
      if (disconnectResult is CallControlResult.Success ||
        (disconnectResult as? CallControlResult.Error)?.errorCode == CallException.ERROR_CALL_IS_NOT_BEING_TRACKED) {
        disconnected.complete(Unit)
      }
      return disconnectResult
    }

    suspend fun addCall(block: CallControlScope.() -> Unit) {
      registrations++
      registrationWait.await()
      block(this)
      disconnected.await()
    }
  }

  @Test fun `activation timeout disconnects without a JS reply`() = runTest {
    val system = SystemCall(coroutineContext)
    lateinit var session: CallTelecomSession
    var ended = false
    session = CallTelecomSession(this, system::addCall) { ended = true; session.close() }
    val activation = async { runCatching { session.activate { it.currentCallEndpoint.first() } } }
    runCurrent()
    advanceTimeBy(30_000)
    runCurrent()
    assertTrue(ended)
    assertTrue(activation.await().exceptionOrNull()!!.message!!.contains("音频建立超时"))
    session.close().await()
    assertEquals(1, system.disconnects)
  }

  @Test fun `empty available endpoints cannot keep a system call connecting forever`() = runTest {
    val system = SystemCall(coroutineContext)
    lateinit var session: CallTelecomSession
    session = CallTelecomSession(this, system::addCall) { session.close() }
    val activation = async { runCatching { session.activate { it.availableEndpoints.first { endpoints -> endpoints.isNotEmpty() } } } }
    runCurrent()
    system.availableEndpoints.emit(emptyList())
    advanceTimeBy(30_000)
    runCurrent()
    assertTrue(activation.await().isFailure)
    session.close().await()
    assertEquals(1, system.disconnects)
  }

  @Test fun `activation failure releases the registered system call`() = runTest {
    val system = SystemCall(coroutineContext)
    system.connectResult = CallControlResult.Error(CallException.ERROR_CALL_CANNOT_BE_SET_TO_ACTIVE)
    lateinit var session: CallTelecomSession
    session = CallTelecomSession(this, system::addCall) { session.close() }
    val result = runCatching {
      session.activate { check(it.setActive() is CallControlResult.Success) { "系统拒绝激活" } }
    }
    assertEquals("系统拒绝激活", result.exceptionOrNull()!!.message)
    session.close().await()
    assertEquals(1, system.disconnects)
  }

  @Test fun `registration failure ends activation without a phantom disconnect`() = runTest {
    lateinit var session: CallTelecomSession
    val failure = IllegalStateException("系统拒绝注册")
    var ended = 0
    session = CallTelecomSession(this, { throw failure }) { ended++; session.close() }
    assertEquals(failure.message, runCatching { session.activate {} }.exceptionOrNull()!!.message)
    session.close().await()
    assertEquals(1, ended)
  }

  @Test fun `hangup during registration disconnects the late handle without activating it`() = runTest {
    val system = SystemCall(coroutineContext)
    val registration = CompletableDeferred<Unit>()
    system.registrationWait = registration
    var connected = false
    val session = CallTelecomSession(this, system::addCall) { error("主动释放不重复上报中断") }
    val activation = async { runCatching { session.activate { connected = true } } }
    runCurrent()
    val released = session.close()
    runCurrent()
    assertFalse(released.isCompleted)
    registration.complete(Unit)
    released.await()
    assertFalse(connected)
    assertTrue(activation.await().isFailure)
    assertEquals(1, system.disconnects)
  }

  @Test fun `duplicate activation and hangup share one system session and release result`() = runTest {
    val system = SystemCall(coroutineContext)
    val response = CompletableDeferred<Unit>()
    system.disconnectWait = response
    val session = CallTelecomSession(this, system::addCall) {}
    session.activate {}
    session.activate { error("接通不会重复执行") }
    val first = session.close()
    assertSame(first, session.close())
    runCurrent()
    assertFalse(first.isCompleted)
    assertEquals(1, system.disconnects)
    response.complete(Unit)
    first.await()
    assertEquals(1, system.registrations)
  }

  @Test fun `disconnect rejection is a failed release rather than an idle session`() = runTest {
    val system = SystemCall(coroutineContext)
    system.disconnectResult = CallControlResult.Error(CallException.ERROR_UNKNOWN)
    val session = CallTelecomSession(this, system::addCall) {}
    session.activate {}
    val released = session.close()
    val failure = runCatching { released.await() }.exceptionOrNull()
    assertTrue(failure!!.message!!.contains("系统通话释放失败"))
    assertSame(released, session.close())
    assertEquals(1, system.disconnects)
  }

  @Test fun `disconnect timeout is bounded and cannot be reported as success`() = runTest {
    val system = SystemCall(coroutineContext)
    system.disconnectWait = CompletableDeferred()
    val session = CallTelecomSession(this, system::addCall) {}
    session.activate {}
    val released = session.close()
    advanceTimeBy(10_000)
    runCurrent()
    assertTrue(released.isCompleted)
    assertTrue(runCatching { released.await() }.exceptionOrNull()!!.message!!.contains("系统通话释放失败"))
    assertEquals(1, system.disconnects)
  }

  @Test fun `system confirmation that the call is no longer tracked completes release`() = runTest {
    val system = SystemCall(coroutineContext)
    system.disconnectResult = CallControlResult.Error(CallException.ERROR_CALL_IS_NOT_BEING_TRACKED)
    val session = CallTelecomSession(this, system::addCall) {}
    session.activate {}
    session.close().await()
    assertEquals(1, system.disconnects)
  }

  @Test fun `system ended call is not disconnected a second time`() = runTest {
    val system = SystemCall(coroutineContext)
    lateinit var session: CallTelecomSession
    var ended = false
    session = CallTelecomSession(this, system::addCall) { ended = true; session.close() }
    session.activate {}
    system.disconnected.complete(Unit)
    runCurrent()
    session.close().await()
    assertTrue(ended)
    assertEquals(0, system.disconnects)
  }

  @Test fun `audio observer failure closes the system session`() = runTest {
    val system = SystemCall(coroutineContext)
    lateinit var session: CallTelecomSession
    session = CallTelecomSession(this, system::addCall) { session.close() }
    session.activate {}
    session.audioScope.launch { throw IllegalStateException("系统音频观察失败") }
    runCurrent()
    session.close().await()
    assertEquals(1, system.disconnects)
  }

  @Test fun `closed call cannot be reactivated`() = runTest {
    var registrations = 0
    val session = CallTelecomSession(this, { registrations++ }) {}
    session.close().await()
    assertTrue(runCatching { session.activate {} }.isFailure)
    assertEquals(0, registrations)
  }
}
