package expo.modules.deviceobserver

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context

/** 只读取当前焦点 Activity 可访问的文字；不监听、不取得焦点，也不解析剪贴板 URI。 */
internal object DeviceClipboardQuery {
  fun read(activity: Activity?): Map<String, Any> {
    if (activity == null || !activity.hasWindowFocus()) {
      return mapOf("status" to "app_not_focused")
    }
    val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    // Android 返回 null 既可能表示空剪贴板，也可能表示访问被拒绝，不能伪造为空的事实。
    val clip = clipboard.primaryClip ?: return mapOf("status" to "clipboard_unavailable")
    if (clip.itemCount == 0) return mapOf("status" to "no_text")
    val text = clip.getItemAt(0).text?.toString() ?: return mapOf("status" to "no_text")
    val characterCount = text.codePointCount(0, text.length)
    val end = text.offsetByCodePoints(0, minOf(characterCount, 12_000))
    return mapOf(
      "status" to "available",
      "text" to text.substring(0, end),
      "truncated" to (end < text.length),
    )
  }
}
