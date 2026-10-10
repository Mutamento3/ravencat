// 普通聊天 AI 回复执行宿主的桥接模块：接收 JS 请求并启动 Headless JS 任务 Service。
package expo.modules.conversationturnruntime

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ConversationTurnRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ConversationTurnRuntime")

    AsyncFunction("startConversationTurnTask") { sessionIds: List<String>, correlationId: String?, deliveryTiming: String? ->
      val reactContext = appContext.reactContext
      if (reactContext == null) {
        Log.w(TAG, "startConversationTurnTask skipped: react context is null")
        return@AsyncFunction false
      }
      ConversationTurnHeadlessTaskService.start(reactContext, sessionIds, correlationId, deliveryTiming)
    }
  }

  companion object {
    private const val TAG = "ConversationTurnRuntime"
  }
}
