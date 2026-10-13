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
  getActiveCall: () => Promise<ChatCallSession | null>;
  startOutgoingCall: (params: StartChatCallParams) => Promise<StartChatCallResult>;
}

export type ChatActiveCallQuerySource =
  | 'chat-detail-mount'
  | 'chat-detail-poll'
  | 'chat-detail-foreground-resume'
  | 'chat-send-preflight'
  | 'chat-retry-preflight';

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
 * Calls 目前不发布可订阅的通话生命周期事件，聊天页只能轮询 + 在真正发送前再确认一次，
 * 因此这条判定必须只有一份实现：UI 的输入框阻断提示与发送前的真实拦截共用它，
 * 否则会出现“输入框已放行但发送仍被拒”或反向的不一致。
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

export async function getActiveChatCall(
  source: ChatActiveCallQuerySource,
): Promise<ChatCallSession | null> {
  const startedAtMs = Date.now();
  try {
    return await getGateway().getActiveCall();
  } finally {
    const durationMs = Date.now() - startedAtMs;
    if (typeof __DEV__ !== 'undefined' && __DEV__ && durationMs > 100) {
      console.info('[ChatActiveCallQuery]', { source, durationMs });
    }
  }
}

export function startOutgoingChatCall(params: StartChatCallParams): Promise<StartChatCallResult> {
  return getGateway().startOutgoingCall(params);
}
