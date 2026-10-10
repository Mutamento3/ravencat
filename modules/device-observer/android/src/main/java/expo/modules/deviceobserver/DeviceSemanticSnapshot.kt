package expo.modules.deviceobserver

import android.view.accessibility.AccessibilityNodeInfo
import expo.modules.kotlin.exception.CodedException

internal class DeviceSemanticReadException(
  val reason: String,
  message: String,
  cause: Throwable? = null,
) : CodedException(
  "ERR_DEVICE_SEMANTIC_READ_${reason.uppercase()}",
  message,
  cause,
)

internal data class DeviceSemanticNode(
  val depth: Int,
  val text: String?,
  val contentDescription: String?,
  val className: String?,
  val clickable: Boolean,
  val editable: Boolean,
  val password: Boolean,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "depth" to depth,
    "text" to text,
    "contentDescription" to contentDescription,
    "className" to className,
    "clickable" to clickable,
    "editable" to editable,
    "password" to password,
  )
}

internal data class DeviceSemanticTruncation(
  val nodeLimitReached: Boolean,
  val depthLimitReached: Boolean,
  val characterLimitReached: Boolean,
) {
  fun toMap(): Map<String, Boolean> = mapOf(
    "nodeLimitReached" to nodeLimitReached,
    "depthLimitReached" to depthLimitReached,
    "characterLimitReached" to characterLimitReached,
  )
}

internal data class DeviceSemanticSnapshot(
  val packageName: String,
  val windowId: Int,
  val capturedAtEpochMs: Long,
  val nodes: List<DeviceSemanticNode>,
  val truncation: DeviceSemanticTruncation,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "packageName" to packageName,
    "windowId" to windowId,
    "capturedAtEpochMs" to capturedAtEpochMs,
    "nodes" to nodes.map(DeviceSemanticNode::toMap),
    "truncation" to truncation.toMap(),
  )
}

/** Android 边界只做有界事实提取；产品级清洗与最终限制由 Screen Observation 负责。 */
internal object DeviceSemanticSnapshotReader {
  private const val MAX_RAW_NODES = 512
  private const val MAX_RAW_DEPTH = 64
  private const val MAX_RAW_FIELD_CHARACTERS = 4_096
  private const val MAX_RAW_TOTAL_CHARACTERS = 131_072

  fun read(
    expected: DeviceWindowIdentity,
    root: AccessibilityNodeInfo,
  ): DeviceSemanticSnapshot {
    val packageName = expected.packageName
      ?: throw DeviceSemanticReadException(
        "window_unavailable",
        "语义读取请求缺少窗口包名",
      )
    val nodes = mutableListOf<DeviceSemanticNode>()
    val pending = ArrayDeque<NodeAtDepth>()
    pending.addLast(NodeAtDepth(root, 0))
    var totalCharacters = 0
    var visitedNodes = 0
    var nodeLimitReached = false
    var depthLimitReached = false
    var characterLimitReached = false

    while (pending.isNotEmpty()) {
      val (node, depth) = pending.removeLast()
      if (visitedNodes >= MAX_RAW_NODES) {
        nodeLimitReached = true
        break
      }
      visitedNodes += 1
      if (depth > MAX_RAW_DEPTH) {
        depthLimitReached = true
        continue
      }
      val password = node.isPassword
      val rawText = if (password) null else normalize(node.text)
      val rawDescription = if (password) null else normalize(node.contentDescription)
      val text = fitField(rawText, MAX_RAW_FIELD_CHARACTERS)
      val description = fitField(rawDescription, MAX_RAW_FIELD_CHARACTERS)
      if (text != rawText || description != rawDescription) {
        characterLimitReached = true
      }
      val remainingCharacters = MAX_RAW_TOTAL_CHARACTERS - totalCharacters
      val fittedText = fitField(text, remainingCharacters)
      totalCharacters += fittedText?.length ?: 0
      val fittedDescription = fitField(
        description,
        MAX_RAW_TOTAL_CHARACTERS - totalCharacters,
      )
      totalCharacters += fittedDescription?.length ?: 0
      val rawClassName = normalize(node.className)
      val className = fitField(
        rawClassName,
        minOf(
          MAX_RAW_FIELD_CHARACTERS,
          MAX_RAW_TOTAL_CHARACTERS - totalCharacters,
        ),
      )
      totalCharacters += className?.length ?: 0
      if (
        fittedText != text || fittedDescription != description || className != rawClassName
      ) {
        characterLimitReached = true
      }

      val semanticNode = DeviceSemanticNode(
        depth = depth,
        text = fittedText,
        contentDescription = fittedDescription,
        className = className,
        clickable = node.isClickable,
        editable = node.isEditable,
        password = password,
      )
      if (node.isVisibleToUser && semanticNode.hasMeaning()) {
        nodes.add(semanticNode)
      }

      if (totalCharacters >= MAX_RAW_TOTAL_CHARACTERS) {
        characterLimitReached = true
        break
      }
      for (childIndex in node.childCount - 1 downTo 0) {
        if (visitedNodes + pending.size >= MAX_RAW_NODES) {
          nodeLimitReached = true
          break
        }
        node.getChild(childIndex)?.let { child ->
          pending.addLast(NodeAtDepth(child, depth + 1))
        }
      }
    }

    return DeviceSemanticSnapshot(
      packageName = packageName,
      windowId = expected.windowId,
      capturedAtEpochMs = System.currentTimeMillis(),
      nodes = nodes,
      truncation = DeviceSemanticTruncation(
        nodeLimitReached = nodeLimitReached,
        depthLimitReached = depthLimitReached,
        characterLimitReached = characterLimitReached,
      ),
    )
  }

  private fun DeviceSemanticNode.hasMeaning(): Boolean {
    return text != null || contentDescription != null || clickable || editable || password
  }

  private fun normalize(value: CharSequence?): String? {
    return value?.toString()?.trim()?.replace(WHITESPACE, " ")?.takeIf(String::isNotEmpty)
  }

  private fun fitField(value: String?, limit: Int): String? {
    if (value == null || limit <= 0) return null
    return value.take(limit).takeIf(String::isNotEmpty)
  }

  private data class NodeAtDepth(
    val node: AccessibilityNodeInfo,
    val depth: Int,
  )

  private val WHITESPACE = Regex("\\s+")
}
