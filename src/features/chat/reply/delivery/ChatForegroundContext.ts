/** 保存宿主提供的 Android 前台会话事实，供后台消息投递决定是否显示系统通知。 */

export interface ChatForegroundContextSnapshot {
  appActive: boolean;
  chatRouteActive: boolean;
  aiId: string | null;
  sessionId: string | null;
  /** 前台群聊的 groupId，非群聊或未在群聊路由时为 null。 */
  groupId: string | null;
  isChatVisible: boolean;
}

let foregroundContext: ChatForegroundContextSnapshot = {
  appActive: false,
  chatRouteActive: false,
  aiId: null,
  sessionId: null,
  groupId: null,
  isChatVisible: false,
};

export function setChatForegroundContext(
  context: ChatForegroundContextSnapshot,
): void {
  foregroundContext = { ...context };
}

export function isChatConversationForeground(
  aiId: string,
  sessionId: string,
): boolean {
  return foregroundContext.appActive
    && foregroundContext.chatRouteActive
    && foregroundContext.isChatVisible
    && foregroundContext.aiId === aiId
    && foregroundContext.sessionId === sessionId;
}

export function isGroupConversationForeground(groupId: string): boolean {
  return foregroundContext.appActive
    && foregroundContext.chatRouteActive
    && foregroundContext.isChatVisible
    && foregroundContext.groupId === groupId;
}

