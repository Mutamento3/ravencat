package expo.modules.ravencatfloatinglayer.bridge

import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import expo.modules.kotlin.types.convert
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayMessageRole
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 使用 Expo 实际参数转换器验证嵌套 DTO；仅测投影模型会漏掉桥接空值问题。 */
@Config(sdk = [35])
@RunWith(RobolectricTestRunner::class)
class RavenCatConversationPreviewRecordTest {
  private fun message(id: Double, role: String, clientMessageId: String?, text: String) = JavaOnlyMap.of(
    "messageId", id, "role", role, "clientMessageId", clientMessageId, "text", text,
  )

  @Test fun nestedNullableClientMessageIdsPreserveMessageIdentityAndText() {
    val input = JavaOnlyMap.of("sessionId", "chat", "messages", JavaOnlyArray.of(
      message(1.0, "user", "request", "用户消息"),
      message(2.0, "assistant", null, "普通回复"),
      message(3.0, "assistant", null, "AI 回复失败：请求超时"),
    ))
    val preview = convert<RavenCatConversationPreviewRecord>(input)
    val messages = preview.messages.map { it.toOverlayMessage() }
    assertEquals("chat", preview.sessionId)
    assertEquals(listOf(1L, 2L, 3L), messages.map { it.messageId })
    assertEquals(listOf("request", null, null), messages.map { it.correlationId })
    assertEquals(RavenCatOverlayMessageRole.USER, messages[0].role)
    assertEquals(RavenCatOverlayMessageRole.ASSISTANT, messages[1].role)
    assertEquals("AI 回复失败：请求超时", messages[2].text)
  }

  @Test fun nullSessionAndEmptyMessagesClearConversation() {
    val preview = convert<RavenCatConversationPreviewRecord>(JavaOnlyMap.of(
      "sessionId", null, "messages", JavaOnlyArray.of(),
    ))
    assertNull(preview.sessionId)
    assertTrue(preview.messages.isEmpty())
  }

  @Test fun emptyMessageTextRemainsEmpty() {
    val preview = convert<RavenCatConversationPreviewRecord>(JavaOnlyMap.of(
      "sessionId", "chat", "messages", JavaOnlyArray.of(message(1.0, "assistant", null, "")),
    ))
    assertEquals("", preview.messages.single().toOverlayMessage().text)
  }

  @Test fun missingMessageIdentityIsRejectedAtBridgeBoundary() {
    assertThrows(Exception::class.java) {
      convert<RavenCatConversationPreviewRecord>(JavaOnlyMap.of("sessionId", "chat", "messages", JavaOnlyArray.of(
        JavaOnlyMap.of("role", "assistant", "clientMessageId", null, "text", "缺少身份"),
      )))
    }
  }
}
