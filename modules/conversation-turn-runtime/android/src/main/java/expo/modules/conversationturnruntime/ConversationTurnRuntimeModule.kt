// 普通聊天 AI 回复执行宿主的桥接模块：接收 JS 请求并启动 Headless JS 任务 Service。
package expo.modules.conversationturnruntime

import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine

class ConversationTurnRuntimeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ConversationTurnRuntime")

    AsyncFunction("startHostRelationshipReplyTask") { aiId: String, change: String, occurredAt: String, promise: Promise ->
      val reactContext = appContext.reactContext
      if (reactContext == null) promise.resolve(false)
      else ConversationTurnHeadlessTaskService.startHostRelationshipReply(reactContext, aiId, change, occurredAt, promise)
    }

    AsyncFunction("startConversationTurnTask") { sessionIds: List<String>, correlationId: String?, deliveryTiming: String?, promise: Promise ->
      val reactContext = appContext.reactContext
      if (reactContext == null) {
        Log.w(TAG, "startConversationTurnTask skipped: react context is null")
        promise.resolve(false)
        return@AsyncFunction
      }
      ConversationTurnHeadlessTaskService.start(reactContext, sessionIds, correlationId, deliveryTiming, promise)
    }

    AsyncFunction("waitForExecutionStop") Coroutine { id: String -> ConversationTurnHostLifetime.awaitStop(id) }
    AsyncFunction("getExecutionRemainingTime") { id: String -> ConversationTurnHostLifetime.remaining(id) }
    AsyncFunction("finishExecution") { id: String -> ConversationTurnHostLifetime.finish(id) }
  }

  companion object {
    private const val TAG = "ConversationTurnRuntime"
  }
}
