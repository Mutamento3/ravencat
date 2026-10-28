package expo.modules.devicecontrol.controller

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.SystemClock
import android.util.Log
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import expo.modules.deviceobserver.DeviceObserverAccessibilityService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.random.Random

/** 每次只执行一个语义步骤；下一步及失败后的重新决策归 AI，原生不持有整段发布流程。 */
internal object XiaohongshuNoteAutomation {
  private const val PACKAGE = "com.xingin.xhs"
  private const val LIFETIME_MS = 20_000L
  private data class Run(val id: String, val deadline: Long, @Volatile var cancelled: Boolean = false)
  private var active: Run? = null
  private val receipts = XiaohongshuPublishReceipts(SystemClock::uptimeMillis)

  @Synchronized fun begin(): String {
    val previous = active
    check(previous == null || SystemClock.uptimeMillis() >= previous.deadline) { "另一条小红书步骤正在执行" }
    val run = Run(UUID.randomUUID().toString(), SystemClock.uptimeMillis() + LIFETIME_MS)
    active = run
    return run.id
  }
  @Synchronized fun cancel(id: String) { active?.takeIf { it.id == id }?.cancelled = true }
  @Synchronized private fun release(id: String) { if (active?.id == id) active = null }

  suspend fun execute(context: Context, id: String, actor: String, command: Map<String, Any?>): Map<String, Any?> =
    withContext(Dispatchers.Main) {
      val run = synchronized(this@XiaohongshuNoteAutomation) { checkNotNull(active?.takeIf { it.id == id }) { "执行预约已失效" } }
      val step = Step(context, run)
      val result = try {
        step.checkActive()
        withTimeout(run.deadline - SystemClock.uptimeMillis()) { step.execute(actor, command) }
      } catch (error: Exception) {
        mapOf("status" to if (step.publishAttempted) "publish_outcome_unknown" else "not_completed",
          "step" to command["operation"], "reason" to (error.message ?: error.javaClass.simpleName),
          "expectedPages" to step.expectedPages, "page" to step.inspect().toMap(),
          "actionAttempted" to step.actionAttempted, "publishAttempted" to step.publishAttempted)
      } finally { release(id) }
      // 不记录文案、话题、凭据或页面文字，仅保留步骤和结果位置供故障定位。
      Log.i("RavenCatXhsStep", "operation=${command["operation"]} status=${result["status"]} page=${(result["page"] as Map<*, *>)["kind"]} attempted=${step.actionAttempted}")
      result
    }

  private class Step(val context: Context, val run: Run) {
    var publishAttempted = false
    var actionAttempted = false
    var expectedPages = emptyList<String>()
    private var clipboardOverwritten = false
    private var observedPage: XiaohongshuPage? = null
    private val service get() = DeviceObserverAccessibilityService.requireActionService()
    private data class Frame(val root: AccessibilityNodeInfo, val nodes: List<AccessibilityNodeInfo>, val page: XiaohongshuPage)

    fun checkActive() {
      check(!run.cancelled && SystemClock.uptimeMillis() < run.deadline) { "步骤已取消或超时" }
      check(synchronized(this@XiaohongshuNoteAutomation) { active === run }) { "执行预约已失效" }
    }

    private fun frame(): Frame {
      val root = service.requireActionRoot(PACKAGE)
      val nodes = mutableListOf<AccessibilityNodeInfo>()
      var visited = 0
      fun visit(node: AccessibilityNodeInfo, depth: Int) {
        check(depth <= 40 && visited++ < 600) { "页面结构超出适配范围" }
        if (node.isVisibleToUser) nodes.add(node)
        for (i in 0 until node.childCount) node.getChild(i)?.let { visit(it, depth + 1) }
      }
      visit(root, 0)
      val elements = nodes.map { node ->
        val rect = Rect().also(node::getBoundsInScreen)
        XiaohongshuElement(if (node.isPassword) "" else node.text?.toString().orEmpty(),
          if (node.isPassword) "" else node.contentDescription?.toString().orEmpty(),
          node.isEditable && !node.isPassword, node.isEnabled, rect.left, rect.top, rect.right, rect.bottom)
      }
      val keyboard = service.windows.any { it.type == AccessibilityWindowInfo.TYPE_INPUT_METHOD }
      val page = XiaohongshuPage.classify(elements, root.windowId, keyboard)
      observedPage = page
      return Frame(root, nodes, page)
    }

    fun inspect(): XiaohongshuPage {
      val state = try { service.observeActionWindow() } catch (error: Exception) {
        return XiaohongshuPage("unavailable", null, null, false, false, emptyList(), error.message)
      }
      return when {
        !state.detectionReliable || state.windowId == null -> XiaohongshuPage("unavailable", state.packageName, state.windowId, false, false, emptyList(), "前台窗口无法可靠识别")
        state.packageName != PACKAGE -> XiaohongshuPage("other_app", state.packageName, state.windowId, true, false, emptyList(), "请把小红书放到前台并收起其他应用小窗；不读取其他应用内容")
        else -> try { frame().page } catch (error: Exception) {
          XiaohongshuPage("unavailable", state.packageName, state.windowId, false, false, emptyList(), error.message)
        }
      }
    }

    private fun requirePage(vararg kinds: String): Frame {
      checkActive()
      expectedPages = kinds.toList()
      val current = frame()
      check(current.page.kind in kinds) { "当前是${current.page.label}；本步骤需要 ${kinds.joinToString()}，请依据返回页面选择下一步" }
      return current
    }

    private fun assertDevice() {
      val bounds = context.getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
      val configuration = context.resources.configuration
      check(Build.MODEL == "V2244A" && bounds.width() == 1080 && bounds.height() == 2400 &&
        configuration.densityDpi == 480 && configuration.fontScale == 1f) { "当前设备配置尚未适配" }
    }

    private suspend fun awaitPage(ready: (XiaohongshuPage) -> Boolean): XiaohongshuPage {
      val deadline = minOf(run.deadline, SystemClock.uptimeMillis() + 8_000)
      while (true) {
        checkActive()
        // 页面切换会暂时失去窗口身份；只等待可读事实恢复，不重新派发动作。
        val page = inspect()
        check(page.kind != "other_app") { "目标应用已离开前台；请先确认当前页面" }
        if (page.reliable && ready(page)) return page
        check(SystemClock.uptimeMillis() < deadline) { "操作结果尚未确认，当前是${page.label}；动作可能已经生效，请只读确认页面后决定下一步" }
        delay(100)
      }
    }

    private suspend fun tap(x: Int, y: Int, beforeDispatch: () -> Unit = {}) {
      delay(Random.nextLong(150, 451))
      val current = frame()
      checkActive()
      val pointX = x + Random.nextInt(-20, 21)
      val pointY = y + Random.nextInt(-10, 11)
      val target = service.windows.first { it.id == current.root.windowId }
      check(service.windows.none {
        it.id != target.id && it.layer > target.layer && Rect().also(it::getBoundsInScreen).contains(pointX, pointY)
      }) { "点击区域被其他窗口遮挡，请收起小窗后确认页面" }
      beforeDispatch()
      actionAttempted = true
      val completed = suspendCancellableCoroutine<Boolean> { continuation ->
        val accepted = service.dispatchGesture(GestureDescription.Builder().addStroke(
          GestureDescription.StrokeDescription(Path().apply { moveTo(pointX.toFloat(), pointY.toFloat()) }, 0, 60)
        ).build(), object : AccessibilityService.GestureResultCallback() {
          override fun onCompleted(gestureDescription: GestureDescription) { if (continuation.isActive) continuation.resume(true) }
          override fun onCancelled(gestureDescription: GestureDescription) { if (continuation.isActive) continuation.resume(false) }
        }, null)
        if (!accepted && continuation.isActive) continuation.resume(false)
      }
      check(completed) { "点击手势未完成；请先确认页面，不自动补点" }
    }

    private suspend fun hideKeyboard() {
      val page = awaitPage { true }
      if (!page.keyboardVisible) return
      check(page.kind != "leave_confirmation") { "当前是离开确认页，请交给用户处理" }
      checkActive()
      actionAttempted = true
      check(service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)) { "无法收起键盘" }
      awaitPage { !it.keyboardVisible }
    }

    private fun editable(current: Frame, role: String): AccessibilityNodeInfo {
      val editors = current.nodes.filter { it.isEditable && !it.isPassword }.sortedBy { Rect().also(it::getBoundsInScreen).top }
      return when (role) {
        "card_text" -> editors.single()
        "title" -> editors.first()
        "body" -> editors.last()
        else -> error("未知编辑字段")
      }
    }

    private suspend fun write(role: String, value: String) {
      require(value.isNotBlank() && value.length <= when (role) { "title" -> 20; "body" -> 500; else -> 300 }) { "文字为空或超出本字段长度" }
      val kind = if (role == "card_text") "card_editor" else "note_editor"
      val target = editable(requirePage(kind), role)
      if (!target.isFocused) {
        actionAttempted = true
        check(target.performAction(AccessibilityNodeInfo.ACTION_FOCUS)) { "无法聚焦目标输入框" }
        awaitPage { it.kind == kind && editable(frame(), role).isFocused }
      }
      checkActive()
      actionAttempted = true
      XiaohongshuTextInput.write(context, editable(requirePage(kind), role), value, paste = false)
      awaitPage { page -> page.kind == kind && when (role) {
        "title" -> page.title; "body" -> page.body; else -> page.editors.single().text
      } == value }
      hideKeyboard()
    }

    private suspend fun addTopic(tag: String) {
      require(tag.isNotBlank() && tag.length <= 20 && tag.none { it.isWhitespace() || it == '#' }) { "话题必须是单个精确名称，不含 # 或空白" }
      requirePage("note_editor")
      hideKeyboard()
      val before = requirePage("note_editor").page.body
      // 同名话题已存在时不再次粘贴，AI 在确认现场后可安全重新调用本步骤。
      if (before.contains("#$tag ")) return
      check(!before.endsWith("#")) { "正文末尾有未完成的话题，请先检查，避免再次插入 #" }
      tap(184, 1408)
      awaitPage { it.kind == "note_editor" && it.body == "$before#" }
      val focused = checkNotNull(requirePage("note_editor").root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)) { "话题输入框没有焦点" }
      actionAttempted = true
      checkActive()
      XiaohongshuTextInput.write(context, focused, tag, paste = true)
      clipboardOverwritten = true
      // 粘贴后可能保留话题浮层；先收起输入层，再在正文页确认精确话题。
      hideKeyboard()
      awaitPage { it.kind == "note_editor" && it.body == "$before#$tag " }
    }

    suspend fun execute(actor: String, command: Map<String, Any?>): Map<String, Any?> {
      val operation = command["operation"] as String
      if (operation == "get_page") return mapOf("status" to "observed", "page" to inspect().toMap(), "step" to operation, "actionAttempted" to false, "publishAttempted" to false)
      assertDevice()
      if (operation !in listOf("prepare_publish", "publish")) receipts.invalidate()
      var draftId: String? = null
      when (operation) {
        "enter_publishing" -> { requirePage("home", "main_page"); tap(493, 2319); awaitPage { it.kind == "creation_menu" } }
        "open_text_entry" -> { requirePage("creation_menu"); tap(447, 2149); awaitPage { it.kind == "text_entry" || it.kind == "card_editor" } }
        "start_text_note" -> { requirePage("text_entry"); tap(716, 1044); awaitPage { it.kind == "card_editor" } }
        "set_card_text" -> write("card_text", command["text"] as String)
        "set_title" -> write("title", command["text"] as String)
        "set_body" -> write("body", command["text"] as String)
        "add_topic" -> addTopic(command["tag"] as String)
        "select_style" -> {
          val slot = (command["slot"] as Number).toInt()
          require(slot in 1..5) { "样式槽位必须为 1 至 5" }
          val x = 147 + (slot - 1) * 222
          fun selected(page: XiaohongshuPage) = page.kind == "card_preview" && page.elements.any { it.text == "换搭配" && (it.left + it.right) / 2 == x }
          if (!selected(requirePage("card_preview").page)) { tap(x, 1950); awaitPage(::selected) }
        }
        "set_visibility" -> {
          val visibility = command["visibility"] as String
          require(visibility in listOf("public", "private")) { "未知可见范围" }
          val initial = requirePage("note_editor", "visibility_picker").page
          val desired = if (visibility == "private") "仅自己可见" else "公开可见"
          if (initial.kind == "note_editor") hideKeyboard()
          if (initial.kind == "visibility_picker" || requirePage("note_editor").page.visibility != desired) {
            if (initial.kind == "note_editor") { tap(256, 1702); awaitPage { it.kind == "visibility_picker" } }
            tap(306, if (visibility == "private") 1796 else 1508)
            awaitPage { it.kind == "note_editor" && it.visibility == desired }
          }
        }
        "next" -> {
          val current = requirePage("card_editor", "card_preview")
          if (current.page.kind == "card_editor") {
            check(current.page.editors.single().text.isNotBlank()) { "请先填写文字卡片" }
            hideKeyboard(); tap(530, 2309); awaitPage { it.kind in listOf("card_preview", "note_editor") }
          } else { tap(886, 2274); awaitPage { it.kind == "note_editor" } }
        }
        "back" -> {
          val before = requirePage("creation_menu", "text_entry", "card_editor", "card_preview", "note_editor", "visibility_picker", "long_article", "unknown").page
          actionAttempted = true
          checkActive()
          check(service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)) { "返回请求被拒绝" }
          awaitPage { it.kind != before.kind || (before.keyboardVisible && !it.keyboardVisible) }
        }
        "prepare_publish" -> { draftId = receipts.issue(actor, requirePage("note_editor").page) }
        "publish" -> {
          requirePage("note_editor")
          tap(724, 2252) {
            receipts.claim(actor, command["draft_id"] as String, requirePage("note_editor").page)
            publishAttempted = true
          }
          awaitPage { it.kind == "published" }
        }
        else -> error("未知小红书步骤")
      }
      return mapOf("status" to if (publishAttempted) "published" else "completed", "step" to operation,
        "page" to checkNotNull(observedPage).toMap(), "draft_id" to draftId, "actionAttempted" to actionAttempted,
        "publishAttempted" to publishAttempted, "clipboardOverwritten" to clipboardOverwritten)
    }
  }
}
