package expo.modules.devicecontrol.controller

import java.util.UUID

/** 准备凭据只绑定当前笔记事实；任何编辑使其失效，派发发布前原子消耗。 */
internal class XiaohongshuPublishReceipts(private val now: () -> Long) {
  private data class Receipt(val id: String, val actor: String, val fingerprint: List<String>, val expires: Long)
  private var receipt: Receipt? = null

  @Synchronized fun issue(actor: String, page: XiaohongshuPage): String {
    check(page.kind == "note_editor" && !page.keyboardVisible && page.visibility != null) { "请先停在键盘收起的待发布页，并确认可见范围" }
    val value = Receipt(UUID.randomUUID().toString(), actor, page.fingerprint, now() + 600_000)
    receipt = value
    return value.id
  }

  @Synchronized fun claim(actor: String, id: String, page: XiaohongshuPage) {
    val value = receipt
    check(value != null && value.id == id && value.actor == actor && now() < value.expires) { "发布凭据无效、已使用或已过期" }
    check(page.kind == "note_editor" && !page.keyboardVisible && page.fingerprint == value.fingerprint) { "页面或笔记内容已改变，请重新检查" }
    receipt = null
  }

  @Synchronized fun invalidate() { receipt = null }
}
