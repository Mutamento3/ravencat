package expo.modules.devicecontrol.controller

/** 仅描述适配器实际读取到的页面事实；不把预期步骤当作当前位置。 */
internal data class XiaohongshuElement(
  val text: String, val description: String = "", val editable: Boolean = false,
  val enabled: Boolean = true, val left: Int = 0, val top: Int = 0,
  val right: Int = 1080, val bottom: Int = 2400,
)

internal data class XiaohongshuPage(
  val kind: String, val packageName: String?, val windowId: Int?, val reliable: Boolean,
  val keyboardVisible: Boolean, val elements: List<XiaohongshuElement>, val issue: String? = null,
) {
  val label: String get() = when (kind) {
    "home" -> "小红书首页"
    "main_page" -> "小红书主页面"
    "creation_menu" -> "创作菜单（从相册选择 / 写文字）"
    "text_entry" -> "写想法 / 写长文分叉页；本工具只走写想法"
    "card_editor" -> "写想法的文字卡片输入页"
    "card_preview" -> "文字卡片样式预览页"
    "note_editor" -> "笔记编辑 / 待发布页"
    "visibility_picker" -> "可见范围选择页"
    "leave_confirmation" -> "返回确认页（不保存返回 / 存草稿）"
    "long_article" -> "写长文页；本工具不支持，请返回写想法路线"
    "published" -> "发布成功页"
    "other_app" -> "当前前台不是小红书"
    "unavailable" -> "当前窗口无法可靠读取"
    else -> "尚未识别的小红书页面"
  }
  val editors get() = elements.filter { it.editable }.sortedBy { it.top }
  val title get() = if (kind == "note_editor") editors.first().text else ""
  val body get() = if (kind == "note_editor") editors.last().text else ""
  val visibility get() = elements.firstOrNull { !it.editable && it.text in listOf("公开可见", "仅自己可见", "仅互关好友可见") }?.text
  val fingerprint get() = listOf(windowId.toString(), title, body, visibility.orEmpty())
  val actions: List<String> get() = when (kind) {
    "home", "main_page" -> listOf("enter_publishing")
    "creation_menu" -> listOf("open_text_entry", "back")
    "text_entry" -> listOf("start_text_note", "back")
    "card_editor" -> listOf("set_card_text", "next", "back")
    "card_preview" -> listOf("select_style", "next", "back")
    "note_editor" -> listOf("set_title", "set_body", "add_topic", "set_visibility", "prepare_publish", "back")
    "visibility_picker" -> listOf("set_visibility", "back")
    "long_article", "unknown" -> listOf("back")
    else -> emptyList()
  }
  fun toMap(): Map<String, Any?> = mapOf(
    "kind" to kind, "label" to label, "packageName" to packageName, "windowId" to windowId,
    "reliable" to reliable, "keyboardVisible" to keyboardVisible, "issue" to issue,
    "availableActions" to actions,
    "fields" to editors.take(3).mapIndexed { index, element -> mapOf(
      "role" to when (kind) { "note_editor" -> if (index == 0) "title" else "body"; "card_editor" -> "card_text"; else -> "editable" },
      "text" to element.text.take(180), "truncated" to (element.text.length > 180),
    ) },
    "visibleLabels" to elements.filterNot { it.editable }.map { it.text.ifEmpty { it.description } }
      .filter { it.isNotBlank() }.distinct().take(16).map { it.take(100) },
  )

  companion object {
    fun classify(elements: List<XiaohongshuElement>, windowId: Int, keyboard: Boolean): XiaohongshuPage {
      fun has(text: String) = elements.any { !it.editable && (it.text == text || it.description == text) }
      val editors = elements.filter { it.editable }
      val kind = when {
        elements.any { !it.editable && it.text == "发布成功！🎉" && it.top < 500 } -> "published"
        has("不保存返回") && has("存草稿") -> "leave_confirmation"
        has("仅互关好友可见") && has("仅自己可见") && editors.isEmpty() -> "visibility_picker"
        has("从相册选择") && has("写文字") -> "creation_menu"
        has("一键排版") && has("写长文") -> "long_article"
        has("发布笔记") && editors.size == 2 -> "note_editor"
        has("预览") && has("选一个喜欢的卡片") -> "card_preview"
        editors.size == 1 && has("下一步") && !has("发布笔记") -> "card_editor"
        has("写想法") && has("写长文") && has("说点什么或提个问题...") -> "text_entry"
        has("首页") && has("发布") && has("发现") -> "home"
        has("首页") && has("发布") && has("消息") -> "main_page"
        else -> "unknown"
      }
      return XiaohongshuPage(kind, "com.xingin.xhs", windowId, true, keyboard, elements)
    }
  }
}
