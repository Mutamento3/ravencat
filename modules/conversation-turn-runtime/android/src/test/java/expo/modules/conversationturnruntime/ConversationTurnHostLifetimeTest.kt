package expo.modules.conversationturnruntime

import android.os.Looper
import expo.modules.kotlin.Promise
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33, 35])
class ConversationTurnHostLifetimeTest {
  private class Result : Promise {
    var value: Any? = null
    override fun resolve(value: Any?) { this.value = value }
    override fun reject(code: String, message: String?, cause: Throwable?) { throw AssertionError(message, cause) }
  }

  @Test
  fun `startup rejection and late acceptance never execute a timed out request`() {
    val result = Result()
    ConversationTurnHostLifetime.request("late-start", result)
    shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(5))
    assertEquals(false, result.value)
    assertFalse(ConversationTurnHostLifetime.accept("late-start"))
    val rejected = Result()
    ConversationTurnHostLifetime.request("rejected-start", rejected)
    ConversationTurnHostLifetime.reject("rejected-start")
    assertEquals(false, rejected.value)
  }

  @Test
  fun `finishing one execution preserves another and timeout is not rewritten as success`() = runBlocking {
    for (id in listOf("first-host", "second-host")) {
      val result = Result()
      ConversationTurnHostLifetime.request(id, result)
      assertTrue(ConversationTurnHostLifetime.accept(id))
      assertEquals(true, result.value)
    }
    val first = async(start = CoroutineStart.UNDISPATCHED) { ConversationTurnHostLifetime.awaitStop("first-host") }
    val second = async(start = CoroutineStart.UNDISPATCHED) { ConversationTurnHostLifetime.awaitStop("second-host") }
    ConversationTurnHostLifetime.finish("first-host")
    assertEquals("completed", first.await())
    assertFalse(second.isCompleted)
    ConversationTurnHostLifetime.stop("second-host", "execution_host_timeout")
    ConversationTurnHostLifetime.finish("second-host")
    assertEquals("execution_host_timeout", second.await())
  }

  @Test
  fun `bridge scheduling allows completion before the stop observer begins`() = runBlocking {
    ConversationTurnHostLifetime.request("completed-before-await", Result())
    assertTrue(ConversationTurnHostLifetime.accept("completed-before-await"))
    ConversationTurnHostLifetime.finish("completed-before-await")
    assertEquals("completed", ConversationTurnHostLifetime.awaitStop("completed-before-await"))
  }
}
