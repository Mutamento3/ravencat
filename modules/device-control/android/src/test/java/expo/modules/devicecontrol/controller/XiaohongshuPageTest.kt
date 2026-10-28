package expo.modules.devicecontrol.controller

import org.junit.Assert.*
import org.junit.Test

class XiaohongshuPageTest {
  private fun label(text: String, top: Int = 100) = XiaohongshuElement(text, top = top)
  private fun edit(text: String, top: Int) = XiaohongshuElement(text, editable = true, top = top)
  private fun page(vararg elements: XiaohongshuElement, keyboard: Boolean = false) = XiaohongshuPage.classify(elements.toList(), 12, keyboard)

  @Test fun creationMenuAndTextForkAreDifferentPages() {
    assertEquals("creation_menu", page(label("从相册选择"), label("写文字")).kind)
    val fork = page(label("写想法"), label("写长文"), label("说点什么或提个问题..."), label("下一步"))
    assertEquals("text_entry", fork.kind)
    assertTrue(fork.label.contains("分叉页"))
    assertEquals(listOf("start_text_note", "back"), fork.actions)
    assertEquals("card_editor", page(label("下一步"), edit("卡片文字", 302)).kind)
  }

  @Test fun longArticleIsReportedButCannotBeEditedThroughTheseTools() {
    val current = page(label("写长文"), label("一键排版"), edit("输入标题", 228), edit("长文正文", 228))
    assertEquals("long_article", current.kind)
    assertEquals(listOf("back"), current.actions)
  }

  @Test fun noteFieldsAreIdentifiedAcrossKeyboardLayoutChanges() {
    val hidden = page(label("发布笔记"), edit("标题", 540), edit("正文#RavenCat ", 690), label("仅自己可见"))
    val keyboard = page(label("发布笔记"), edit("标题", 450), edit("正文#RavenCat ", 600), label("仅自己可见"), keyboard = true)
    assertEquals("note_editor", hidden.kind)
    assertEquals(hidden.title, keyboard.title)
    assertEquals(hidden.body, keyboard.body)
    assertEquals(hidden.fingerprint, keyboard.fingerprint)
    assertTrue(keyboard.keyboardVisible)
  }

  @Test fun inputTextCannotPretendToBePublishSuccess() {
    val current = page(label("发布笔记"), edit("发布成功！🎉", 450), edit("正文", 600))
    assertEquals("note_editor", current.kind)
    assertEquals("published", page(label("发布成功！🎉", 300)).kind)
    val controlsInBody = page(label("发布笔记"), edit("写长文", 450), edit("一键排版", 600), label("仅自己可见"))
    assertEquals("note_editor", controlsInBody.kind)
    assertEquals("仅自己可见", page(label("发布笔记"), edit("标题", 450), edit("公开可见", 600), label("仅自己可见")).visibility)
  }

  @Test fun unrecognizedPageIsExplicitAndFieldSummariesAreBounded() {
    assertEquals("unknown", page(label("未知页面")).kind)
    assertEquals(listOf("back"), page(label("未知页面")).actions)
    assertTrue(page(label("仅互关好友可见"), label("仅自己可见")).actions.contains("set_visibility"))
    val current = page(label("发布笔记"), edit("标题", 540), edit("文".repeat(500), 690))
    val fields = current.toMap()["fields"] as List<*>
    val body = fields[1] as Map<*, *>
    assertEquals(180, (body["text"] as String).length)
    assertEquals(true, body["truncated"])
  }

  @Test fun leavingDraftRequiresHumanDecision() {
    val current = page(label("不保存返回"), label("存草稿"))
    assertEquals("leave_confirmation", current.kind)
    assertTrue(current.actions.isEmpty())
  }
}
