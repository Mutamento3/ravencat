/** Chat 会话只依赖通话能力端口，由宿主注入 Calls 的具体实现。 */

import type { AIAssistantConfig } from '../../messages/application/SendUserMessage';
import type { ChatMessage } from '../../messages/domain/ChatMessage';

export interface ChatCallSession {
  id: string;
  chatSessionId: string;
  aiAssistantId: string;
  state: string;
}

export interface StartChatCallParams {
  chatSessionId: string;
  aiConfig: AIAssistantConfig;
  requestedMode: 'video';
  onCallCreated?: (call: ChatCallSession) => void;
}

export type StartChatCallResult =
  | { status: 'ended'; call: ChatCallSession; visibleMessages: ChatMessage[] }
  | { status: 'accepted'; call: ChatCallSession; visibleMessages: ChatMessage[] }
  | { status: 'rejected'; call: ChatCallSession; visibleMessages: ChatMessage[] }
  | { status: 'failed'; call: ChatCallSession | null; errorMessage: string; visibleMessages: ChatMessage[] };

interface ChatCallGateway {
  getActiveCallSnapshot: () => ChatCallSession | null;
  subscribeActiveCall: (listener: () => void) => () => void;
  startOutgoingCall: (params: StartChatCallParams) => Promise<StartChatCallResult>;
}

let gateway: ChatCallGateway | null = null;

export function configureChatCallGateway(nextGateway: ChatCallGateway): void {
  gateway = nextGateway;
}

function getGateway(): ChatCallGateway {
  if (!gateway) {
    throw new Error('ChatCallGateway 尚未由宿主配置');
  }
  return gateway;
}

/**
 * 判断当前通话是否阻断这个聊天会话的普通消息发送。
 *
 * 输入框与发送动作共享 Calls 生命周期持有的接通标记，避免展示状态与即时输入判定分叉。
 */
export function isChatSendBlockedByCall(
  activeCall: ChatCallSession | null,
  sessionId: string | null | undefined,
  aiAssistantId: string | null | undefined
): boolean {
  if (activeCall?.state !== 'active') {
    return false;
  }
  return activeCall.chatSessionId === sessionId || activeCall.aiAssistantId === aiAssistantId;
}

export function getActiveChatCall(): ChatCallSession | null {
  return getGateway().getActiveCallSnapshot();
}

export function subscribeActiveChatCall(listener: () => void): () => void {
  return getGateway().subscribeActiveCall(listener);
}

export function startOutgoingChatCall(params: StartChatCallParams): Promise<StartChatCallResult> {
  return getGateway().startOutgoingCall(params);
}
