/** 会话引用：统一描述单聊与群聊会话，供通知聚合、前台抑制与已读语义共用。 */

export type ConversationKind = 'direct' | 'group';

export interface ConversationRef {
  kind: ConversationKind;
  /** 通知聚合与撤销 key：direct = `ai:<aiId>`；group = `group:<groupId>`（独立字段，不伪造 aiId） */
  key: string;
  /** 通知标题：单聊 = AI 名；群聊 = 群名 */
  title: string;
  /** 群聊 sessionId = groupId */
  sessionId: string;
  /** direct 会话 AI，或群消息发送者 AI */
  aiId?: string | null;
  groupId?: string | null;
  groupName?: string | null;
}

export function conversationKeyOfDirect(aiId: string): string {
  return `ai:${aiId}`;
}

export function conversationKeyOfGroup(groupId: string): string {
  return `group:${groupId}`;
}
