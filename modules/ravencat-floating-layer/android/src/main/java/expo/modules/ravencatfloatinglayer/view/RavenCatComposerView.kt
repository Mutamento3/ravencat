package expo.modules.ravencatfloatinglayer.view

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import expo.modules.ravencatfloatinglayer.R
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlayIntent
import expo.modules.ravencatfloatinglayer.model.RavenCatOverlaySnapshot
import expo.modules.ravencatfloatinglayer.model.RavenCatScreenshotState
import java.util.UUID

internal class RavenCatComposerView(
  context: Context,
  private val onIntent: (RavenCatOverlayIntent) -> Unit,
) : LinearLayout(context) {
  private val inputView = RavenCatComposerEditText(context) {
    onIntent(RavenCatOverlayIntent.ReleaseInputFocus)
  }
  private var isRendering = false
  private var canSendScreenshot = false
  private var isCapturing = false
  private val sendView = ImageView(context)

  init {
    orientation = HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL

    inputView.apply {
      hint = "给 RavenCat 发消息…"
      setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14f)
      setSingleLine(true)
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      setTextColor(Color.parseColor("#111827"))
      setHintTextColor(Color.parseColor("#9CA3AF"))
      setPadding(dp(16), 0, dp(16), 0)
      background = GradientDrawable().apply {
        cornerRadius = dp(20).toFloat()
        setColor(Color.parseColor("#F3F4F6"))
      }
      contentDescription = "RavenCat 消息输入框"
      setOnTouchListener { _, event ->
        if (event.actionMasked == MotionEvent.ACTION_DOWN) {
          onIntent(RavenCatOverlayIntent.RequestInputFocus)
        }
        false
      }
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(value: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(value: CharSequence?, start: Int, before: Int, count: Int) = Unit
        override fun afterTextChanged(value: Editable?) {
          if (!isRendering) {
            onIntent(RavenCatOverlayIntent.DraftChanged(value?.toString().orEmpty()))
          }
        }
      })
    }

    addView(inputView, LayoutParams(0, dp(40), 1f).apply { rightMargin = dp(8) })
    addView(
      sendView.apply {
        setImageResource(R.drawable.ravencat_send)
        scaleType = ImageView.ScaleType.CENTER
        background = GradientDrawable().apply {
          shape = GradientDrawable.OVAL
          setColor(Color.parseColor("#3A9BEF"))
        }
        isClickable = true
        isFocusable = true
        contentDescription = "发送 RavenCat 消息"
        setOnClickListener { sendCurrentInput() }
      },
      LayoutParams(dp(40), dp(40)),
    )
  }

  fun render(snapshot: RavenCatOverlaySnapshot) {
    canSendScreenshot = snapshot.stagedScreenshot != null
    isCapturing = snapshot.screenshotState == RavenCatScreenshotState.HIDING ||
      snapshot.screenshotState == RavenCatScreenshotState.CAPTURING
    sendView.isEnabled = !isCapturing
    sendView.alpha = if (isCapturing) 0.5f else 1f
    inputView.hint = if (canSendScreenshot) "补充消息，或直接发送截图…" else "给 RavenCat 发消息…"
    if (inputView.text.toString() == snapshot.draft) return
    isRendering = true
    inputView.setText(snapshot.draft)
    inputView.setSelection(snapshot.draft.length)
    isRendering = false
  }

  fun requestInputFocus() {
    inputView.requestFocus()
    val manager = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
    manager.showSoftInput(inputView, InputMethodManager.SHOW_IMPLICIT)
  }

  fun clearInputFocus() {
    inputView.clearFocus()
  }

  private fun sendCurrentInput() {
    val text = inputView.text.toString().trim()
    if (isCapturing || (text.isEmpty() && !canSendScreenshot)) return
    onIntent(RavenCatOverlayIntent.Send(text, buildCorrelationId()))
  }

  private fun buildCorrelationId(): String {
    return "floating_${System.currentTimeMillis()}_${UUID.randomUUID().toString().take(8)}"
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}

private class RavenCatComposerEditText(
  context: Context,
  private val onImeBackReleased: () -> Unit,
) : EditText(context) {
  override fun onKeyPreIme(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
      onImeBackReleased()
    }
    return super.onKeyPreIme(keyCode, event)
  }
}
