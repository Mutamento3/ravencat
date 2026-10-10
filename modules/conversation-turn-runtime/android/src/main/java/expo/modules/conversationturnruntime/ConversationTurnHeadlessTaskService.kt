// 普通聊天 AI 回复执行的 Headless JS 宿主：以 Service 生命周期持有任务，不依赖 React 页面 runtime。
package expo.modules.conversationturnruntime

import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class ConversationTurnHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      TASK_KEY,
      Arguments.fromBundle(extras),
      TASK_TIMEOUT_MS,
      true,
    )
  }

  companion object {
    private const val TAG = "ConversationTurnService"
    const val TASK_KEY = "ConversationTurnExecutionTask"
    private const val TASK_TIMEOUT_MS = 600_000L

    /** 启动对话轮次执行任务；失败时保留 pending 事实，等待后续 host/recovery 接管，不做页面兜底。 */
    fun start(
      context: Context,
      sessionIds: List<String>,
      correlationId: String?,
      deliveryTiming: String?,
    ): Boolean {
      val intent = Intent(context, ConversationTurnHeadlessTaskService::class.java).apply {
        putStringArrayListExtra("sessionIds", ArrayList(sessionIds))
        putExtra("correlationId", correlationId)
        putExtra("deliveryTiming", deliveryTiming)
        putExtra("createdAtEpochMs", System.currentTimeMillis().toDouble())
      }

      return try {
        acquireWakeLockNow(context)
        context.startService(intent)
        true
      } catch (e: RuntimeException) {
        Log.e(TAG, "start ConversationTurnHeadlessTaskService failed", e)
        false
      }
    }
  }
}
