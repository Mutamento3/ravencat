/** 定义聊天会话实体与仓储端口。 */

/**
 * 一次「清除聊天记录」推进的会话级逻辑历史边界。
 *
 * 边界按每条流自己的身份单位表达，两个 facet 由同一次清除原子写入：
 * - `visibleAfterMessageId`：Chat Message 流的位置（message.id 高水位）。
 * - `visibleAfterAt`：清除时刻。CallEvent 没有数值/单调 cursor（id 是带随机后缀
 *   的文本），通话上下文只能用时间定位「该操作之后产生的事件」。
 *
 * 二者都不是 callId 级归属：同一通跨 boundary 的电话，边界之前产生的事件不可见，
 * 之后产生的事件照常可见。
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
  /** 当前界面与普通短期 Prompt 只读取此消息 ID 之后的时间线。 */
  visibleAfterMessageId: number | null;
  /** 只读取此时刻之后产生 / 追加的 CallEvent；null 表示从未清除过。 */
  visibleAfterAt: string | null;
}

/**
 * 每个 AI 永久只有一个 canonical 单聊 conversation。
 * 端口只保留：按 AI 拿到/确保唯一会话、按会话 ID 定位、推进历史边界、切换置顶。
 * 不存在新建会话、重命名、归档、切换或单独删除 direct session 的能力。
 */
export interface ISessionRepository {
  getCanonicalConversation(aiId: string): Promise<ChatSession | null>;
  resolveCanonicalConversation(aiId: string, now?: Date): Promise<ChatSession>;
  /** 按会话 ID 定位 canonical conversation；notification / recovery / turn 路径使用。 */
  getSession(sessionId: string): Promise<ChatSession | null>;
  /** 推进非破坏式历史边界，返回边界消息 ID；没有消息时返回 null。 */
  clearConversationHistory(sessionId: string): Promise<number | null>;
  /**
   * 切换会话列表置顶：置顶写 `is_pinned = 1` + `pinned_at = 置顶时刻`，
   * 取消置顶把两者一起归零（`pinned_at = NULL` 才能真正回到真实消息排序）。
   * 只改置顶事实，绝不触碰 last_message / last_time。会话不存在返回 null。
   */
  setConversationPinned(sessionId: string, pinned: boolean): Promise<ChatSession | null>;
}
