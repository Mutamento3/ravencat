package expo.modules.ravencatfloatinglayer.bridge

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.records.Required
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayMessage
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayMessageRole

/** 嵌套消息的空值必须由字段类型转换，不能走 Map<String, Any?> 的递归 Any 转换。 */
internal class RavenCatConversationPreviewRecord : Record {
  @Field @Required
  var sessionId: String? = null

  @Field @Required
  lateinit var messages: List<RavenCatConversationMessageRecord>
}

internal class RavenCatConversationMessageRecord : Record {
  @Field @Required
  var messageId: Long = 0

  @Field @Required
  var clientMessageId: String? = null

  @Field @Required
  lateinit var role: String

  @Field @Required
  lateinit var text: String

  fun toOverlayMessage() = RavenCatOverlayMessage(
    role = when (role) {
      "user" -> RavenCatOverlayMessageRole.USER
      "assistant" -> RavenCatOverlayMessageRole.ASSISTANT
      else -> error("悬浮会话投影包含未知消息角色")
    },
    text = text,
    correlationId = clientMessageId,
    messageId = messageId,
  )
}
