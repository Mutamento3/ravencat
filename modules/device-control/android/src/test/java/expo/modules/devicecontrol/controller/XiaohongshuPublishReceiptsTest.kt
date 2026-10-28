package expo.modules.devicecontrol.controller

import org.junit.Assert.*
import org.junit.Test

class XiaohongshuPublishReceiptsTest {
  private var time = 1000L
  private val receipts = XiaohongshuPublishReceipts { time }
  private fun page(body: String = "正文", keyboard: Boolean = false) = XiaohongshuPage.classify(listOf(
    XiaohongshuElement("发布笔记"), XiaohongshuElement("标题", editable = true, top = 540),
    XiaohongshuElement(body, editable = true, top = 690), XiaohongshuElement("仅自己可见")
  ), 12, keyboard)

  @Test fun onlyIssuingActorCanClaimAndClaimIsOneTime() {
    val id = receipts.issue("host", page())
    assertThrows(IllegalStateException::class.java) { receipts.claim("other", id, page()) }
    receipts.claim("host", id, page())
    assertThrows(IllegalStateException::class.java) { receipts.claim("host", id, page()) }
  }

  @Test fun changedContentAndExpiredReceiptsCannotPublish() {
    val id = receipts.issue("host", page())
    assertThrows(IllegalStateException::class.java) { receipts.claim("host", id, page("修改后")) }
    time += 600_000
    assertThrows(IllegalStateException::class.java) { receipts.claim("host", id, page()) }
  }

  @Test fun editingInvalidatesReceiptAndKeyboardMustBeClosed() {
    assertThrows(IllegalStateException::class.java) { receipts.issue("host", page(keyboard = true)) }
    val id = receipts.issue("host", page())
    receipts.invalidate()
    assertThrows(IllegalStateException::class.java) { receipts.claim("host", id, page()) }
  }
}
