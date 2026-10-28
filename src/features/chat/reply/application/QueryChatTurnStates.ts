/** 供跨 Feature 的上下文凭据核对提交事实，不授予执行或消息写入能力。 */
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';

export function listChatTurnStates(runIds: readonly string[]) {
  return getChatMessageRuntimeDependencies().turns.listRunStates(runIds);
}
