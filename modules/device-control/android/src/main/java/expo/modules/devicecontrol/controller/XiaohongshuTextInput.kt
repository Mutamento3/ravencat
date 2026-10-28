package expo.modules.devicecontrol.controller

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo

/** 普通字段整体设字；话题只能在光标处粘贴，避免破坏已经生成的话题 span。 */
internal object XiaohongshuTextInput {
  fun write(context: Context, editor: AccessibilityNodeInfo, text: String, paste: Boolean) {
    check(editor.isFocused && editor.isEditable && editor.isEnabled && !editor.isPassword) { "当前焦点不是可编辑的普通文本框" }
    val action = if (paste) AccessibilityNodeInfo.ACTION_PASTE else AccessibilityNodeInfo.ACTION_SET_TEXT
    val arguments = if (paste) {
      val end = editor.text?.length ?: 0
      check(editor.textSelectionStart == end && editor.textSelectionEnd == end) { "话题输入光标不在正文末尾" }
      val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
      clipboard.setPrimaryClip(ClipData.newPlainText("RavenCat", text))
      null
    } else Bundle().apply {
      putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
    }
    // 节点动作列表是写剪贴板前的快照，不能据此否决粘贴；以实际派发及上层正文核验为准。
    // 一次调用只派发一次；false 或结果不明都不能改用另一种方式再次输入。
    check(editor.performAction(action, arguments)) { "目标应用拒绝文本输入" }
  }
}
