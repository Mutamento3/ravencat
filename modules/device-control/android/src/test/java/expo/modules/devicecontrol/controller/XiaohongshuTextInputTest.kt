package expo.modules.devicecontrol.controller

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.graphics.Typeface
import android.view.accessibility.AccessibilityNodeInfo
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], manifest = Config.NONE)
class XiaohongshuTextInputTest {
  private val context get() = RuntimeEnvironment.getApplication()
  private val clipboard get() = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
  private fun editor() = AccessibilityNodeInfo.obtain().apply {
    isFocused = true
    isEditable = true
    isEnabled = true
    addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT)
    addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_PASTE)
  }

  @Test fun directTextPreservesUnicodeAndDoesNotChangeClipboard() {
    clipboard.setPrimaryClip(ClipData.newPlainText("原文字", "用户剪贴板"))
    val editor = editor()
    val expected = "中文 AbC 20261026\n第二行 🐈"
    shadowOf(editor).setOnPerformActionListener { action, arguments ->
      assertEquals(AccessibilityNodeInfo.ACTION_SET_TEXT, action)
      editor.text = arguments.getCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE)
      true
    }
    XiaohongshuTextInput.write(context, editor, expected, paste = false)
    assertEquals(expected, editor.text.toString())
    assertEquals("用户剪贴板", clipboard.primaryClip!!.getItemAt(0).text)
  }

  @Test fun successivePastesAppendAndPreserveExistingSpan() {
    val editor = editor()
    val content = SpannableStringBuilder("正文 #已有话题 ")
    val span = StyleSpan(Typeface.BOLD)
    content.setSpan(span, 3, 8, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    editor.text = content
    editor.setTextSelection(content.length, content.length)
    shadowOf(editor).setOnPerformActionListener { action, _ ->
      assertEquals(AccessibilityNodeInfo.ACTION_PASTE, action)
      content.append(clipboard.primaryClip!!.getItemAt(0).text)
      editor.text = content
      editor.setTextSelection(content.length, content.length)
      true
    }
    XiaohongshuTextInput.write(context, editor, "RavenCat", paste = true)
    XiaohongshuTextInput.write(context, editor, "中文20261026", paste = true)
    assertEquals("正文 #已有话题 RavenCat中文20261026", content.toString())
    assertEquals(3, content.getSpanStart(span))
    assertEquals("中文20261026", clipboard.primaryClip!!.getItemAt(0).text)
  }

  @Test fun rejectedActionIsNotRetriedOrReplacedWithAnotherMethod() {
    val editor = editor()
    var attempts = 0
    shadowOf(editor).setOnPerformActionListener { _, _ -> attempts++; false }
    assertThrows(IllegalStateException::class.java) {
      XiaohongshuTextInput.write(context, editor, "文字", paste = false)
    }
    assertEquals(1, attempts)
  }

  @Test fun pasteUsesPreparedClipboardEvenWhenCapturedActionsOmitPaste() {
    clipboard.clearPrimaryClip()
    val editor = editor().apply {
      removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_PASTE)
      text = "正文#"
      setTextSelection(text.length, text.length)
    }
    var attempts = 0
    shadowOf(editor).setOnPerformActionListener { action, _ ->
      attempts++
      assertEquals(AccessibilityNodeInfo.ACTION_PASTE, action)
      val pasted = clipboard.primaryClip!!.getItemAt(0).text
      assertEquals("RavenCat", pasted)
      editor.text = editor.text.toString() + pasted
      true
    }
    XiaohongshuTextInput.write(context, editor, "RavenCat", paste = true)
    assertEquals("正文#RavenCat", editor.text.toString())
    assertEquals(1, attempts)
  }

  @Test fun rejectedPasteIsNotRetriedOrReplacedWithSetText() {
    val editor = editor().apply {
      removeAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_PASTE)
      text = "正文#"
      setTextSelection(text.length, text.length)
    }
    var attempts = 0
    shadowOf(editor).setOnPerformActionListener { action, _ ->
      attempts++
      assertEquals(AccessibilityNodeInfo.ACTION_PASTE, action)
      false
    }
    assertThrows(IllegalStateException::class.java) {
      XiaohongshuTextInput.write(context, editor, "话题", paste = true)
    }
    assertEquals(1, attempts)
    assertEquals("正文#", editor.text.toString())
  }

  @Test fun passwordOrUnfocusedEditorCannotReceiveClipboardOrText() {
    clipboard.setPrimaryClip(ClipData.newPlainText("原文字", "用户剪贴板"))
    val editor = editor()
    editor.isPassword = true
    assertThrows(IllegalStateException::class.java) { XiaohongshuTextInput.write(context, editor, "话题", paste = true) }
    editor.isPassword = false
    editor.isFocused = false
    assertThrows(IllegalStateException::class.java) { XiaohongshuTextInput.write(context, editor, "正文", paste = false) }
    assertEquals("用户剪贴板", clipboard.primaryClip!!.getItemAt(0).text)
    assertTrue(shadowOf(editor).performedActions.isEmpty())
  }

  @Test fun selectionInExistingTopicIsRejectedBeforeChangingClipboard() {
    clipboard.setPrimaryClip(ClipData.newPlainText("原文字", "用户剪贴板"))
    val editor = editor()
    editor.text = "正文 #RavenCat "
    editor.setTextSelection(3, 12)
    assertThrows(IllegalStateException::class.java) { XiaohongshuTextInput.write(context, editor, "新话题", paste = true) }
    assertEquals("用户剪贴板", clipboard.primaryClip!!.getItemAt(0).text)
    assertTrue(shadowOf(editor).performedActions.isEmpty())
  }
}
