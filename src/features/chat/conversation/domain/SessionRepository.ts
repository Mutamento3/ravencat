import type { DatabaseTransactionExecutor } from '@platform/persistence';
/** 定义聊天会话实体与仓储端口。 */

/**
 * canonical 单聊身份及列表状态。清除历史物理删除消息，保留会话、摘要和记忆空间。
 * 通话记录独立保留，聊天上下文按清除时刻过滤 CallEvent，同一通电话此后新事件仍可见。
 */
export interface ChatSession {
  id: string;
  aiAssistantId: string;
  name: string;
  tags?: string[];
  lastMessage?: string | null;
  /**
   * 最后一条**可见**消息的创建时间。
   * 为 null / 空字符串表示当前可见时间线没有消息（从未有过 / 已 clear /
   * 可见消息被删空）；会话列表排序此时回落到 createdAt。
   */
  lastTime?: string | null;
  /** 会话列表置顶分区。置顶只决定分区，分区内按置顶区有效时间排序。 */
  isPinned: boolean;
  /**
   * 最近一次置顶时刻。未置顶为 null。
   * 置顶区有效排序时间 = max(lastTime, pinnedAt)：刚置顶立刻到顶部，
   * 但置顶本身不产生任何消息活动（不得改写 lastTime）。
   */
  pinnedAt: string | null;
  /** 旧版本保留的消息可见边界；再次清除时连同隐藏原文一起删除并归零。 */
  visibleAfterMessageId: number | null;
  /** 只读取此时刻之后产生 / 追加的 CallEvent；null 表示从未清除过。 */
  visibleAfterAt: string | null;
}

/**
 * 每个 AI 永久只有一个 canonical 单聊 conversation。
 * 端口只保留：按 AI 拿到/确保唯一会话、按会话 ID 定位、删除全部聊天历史、切换置顶。
 * 不存在新建会话、重命名、归档、切换或单独删除 direct session 的能力。
 */
export interface ISessionRepository {
  getCanonicalConversation(aiId: string): Promise<ChatSession | null>;
  resolveCanonicalConversation(aiId: string, now?: Date): Promise<ChatSession>;
  resolveCanonicalConversationInTransaction(transaction: DatabaseTransactionExecutor, aiId: string, now: Date): Promise<ChatSession>;
  /** 按会话 ID 定位 canonical conversation；notification / recovery / turn 路径使用。 */
  getSession(sessionId: string): Promise<ChatSession | null>;
  /** 原子删除全部消息、展示快照及重写版本，返回 commit 后需释放的媒体引用候选。 */
  clearConversationHistory(sessionId: string): Promise<string[]>;
  /**
   * 切换会话列表置顶：置顶写 `is_pinned = 1` + `pinned_at = 置顶时刻`，
   * 取消置顶把两者一起归零（`pinned_at = NULL` 才能真正回到真实消息排序）。
   * 只改置顶事实，绝不触碰 last_message / last_time。会话不存在返回 null。
   */
  setConversationPinned(sessionId: string, pinned: boolean): Promise<ChatSession | null>;
}
