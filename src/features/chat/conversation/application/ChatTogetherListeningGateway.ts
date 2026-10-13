/** Chat 会话只依赖 Together Listening 能力端口，由宿主注入具体实现。 */

import type { AIAssistantConfig } from '../../messages/application/SendUserMessage';

export type ChatTogetherListeningPhase =
  | 'pending_user_response'
  | 'pending_ai_response'
  | 'active'
  | 'declined_by_user'
  | 'declined_by_ai'
  | 'ended';

export type ChatTogetherListeningEndReason =
  | 'user_left'
  | 'ai_left'
  | 'media_unavailable'
  | 'host_authority_lost'
  | 'chat_unavailable'
  | 'runtime_reconciliation'
  | 'unknown';

/**
 * Chat 只携带 Activity 生命周期快照，不携带歌曲、播放进度等媒体事实。
 * 媒体事实仍由 Together Listening runtime/prompt 负责。
 */
export interface ChatTogetherListeningActivity {
  id: string;
  chatSessionId: string;
  hostAiId: string;
  initiator: 'user' | 'ai';
  phase: ChatTogetherListeningPhase;
  endReason: ChatTogetherListeningEndReason | null;
}

export interface ChatTogetherListeningContext {
  chatSessionId: string;
  aiConfig: AIAssistantConfig;
}

export interface ChatTogetherListeningActivityActionParams {
  chatSessionId: string;
  aiConfig: Pick<AIAssistantConfig, 'id' | 'isHostAI'>;
  activityId: string;
}

export type ChatTogetherListeningResultStatus =
  | 'invitation_created'
  | 'activity_in_progress'
  | 'invitation_accepted'
  | 'invitation_declined'
  | 'left'
  | 'unavailable'
  | 'transition_conflict'
  | 'failed';

export interface ChatTogetherListeningResult {
  status: ChatTogetherListeningResultStatus;
  activity?: ChatTogetherListeningActivity | null;
  reason?: string;
  message: string;
}

export interface ChatTogetherListeningGateway {
  invite: (params: ChatTogetherListeningContext) => Promise<ChatTogetherListeningResult>;
  accept: (
    params: ChatTogetherListeningActivityActionParams,
  ) => Promise<ChatTogetherListeningResult>;
  decline: (
    params: ChatTogetherListeningActivityActionParams,
  ) => Promise<ChatTogetherListeningResult>;
  leave: (
    params: ChatTogetherListeningActivityActionParams,
  ) => Promise<ChatTogetherListeningResult>;
}

let gateway: ChatTogetherListeningGateway | null = null;

export function shouldShowTogetherListeningChatEntry(
  aiAssistant: Pick<AIAssistantConfig, 'isHostAI'> | null | undefined,
): boolean {
  return aiAssistant?.isHostAI === true;
}

export function configureChatTogetherListeningGateway(
  nextGateway: ChatTogetherListeningGateway,
): void {
  gateway = nextGateway;
}

function getGateway(): ChatTogetherListeningGateway {
  if (!gateway) {
    throw new Error('ChatTogetherListeningGateway 尚未由宿主配置');
  }
  return gateway;
}

export function inviteTogetherListeningFromChat(
  params: ChatTogetherListeningContext,
): Promise<ChatTogetherListeningResult> {
  return getGateway().invite(params);
}

export function acceptChatTogetherListeningInvitation(
  params: ChatTogetherListeningActivityActionParams,
): Promise<ChatTogetherListeningResult> {
  return getGateway().accept(params);
}

export function declineChatTogetherListeningInvitation(
  params: ChatTogetherListeningActivityActionParams,
): Promise<ChatTogetherListeningResult> {
  return getGateway().decline(params);
}

export function leaveChatTogetherListening(
  params: ChatTogetherListeningActivityActionParams,
): Promise<ChatTogetherListeningResult> {
  return getGateway().leave(params);
}
