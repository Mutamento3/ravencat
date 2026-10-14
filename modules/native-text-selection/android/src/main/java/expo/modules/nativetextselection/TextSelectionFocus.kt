package expo.modules.nativetextselection

import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView

/** 编辑输入与只读文字选择属于不同焦点所有者。 */
internal fun View.isReadOnlyTextSelection(): Boolean =
  this is TextView && this !is EditText && isTextSelectable

internal fun releaseTextSelectionFocus(focused: View?) {
  if (focused == null || !focused.isReadOnlyTextSelection()) return
  val root = focused.rootView as ViewGroup
  val previous = root.descendantFocusability
  // clearFocus 默认会从根窗口寻找下一个焦点，折叠时不得转移给输入框或其他思维链。
  root.descendantFocusability = ViewGroup.FOCUS_BLOCK_DESCENDANTS
  try {
    focused.clearFocus()
  } finally {
    root.descendantFocusability = previous
  }
}

internal class TextSelectionFocusScrollPolicy {
  var blocksScroll: Boolean = false
    private set

  fun requestChildFocus(focused: View, request: () -> Unit) {
    val previous = blocksScroll
    blocksScroll = focused.isInTouchMode && focused.isReadOnlyTextSelection()
    try {
      request()
    } finally {
      blocksScroll = previous
    }
  }
}
