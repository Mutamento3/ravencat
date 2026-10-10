/**
 * @fileoverview ToolContext - AI 工具执行上下文
 *
 * 封装工具执行时需要的所有依赖：
 * - AI 配置（aiConfig）
 * - 会话信息（sessionId）
 * - 数据仓储（repositories）
 * - 回调函数（错误处理、UI 通知）
 *
 * @module shared/aiTools/ToolContext
 */

// AI 配置类型
export interface ToolAIConfig {
  id: string;
  agentId?: string;
  name: string;
  isHostAI?: boolean;
  isBlocked?: boolean;
  [key: string]: any;
}

// 仓储集合类型
export interface ToolRepositories {
  /** 仅需要聊天历史的工具才注入该能力；朋友圈工具不持有 Chat repository。 */
  message?: unknown;
  protocol: unknown | null;
  moment: unknown | null;
  profile: unknown;
  // Wallet 拥有具体端口，功能内工具会收窄这里注入的值。
  ledger: unknown | null;
}

// 回调函数类型
export interface ToolCallbacks {
  /**
   * 错误处理回调
   */
  onError?: (message: string) => void;

  /**
   * UI 通知回调
   */
  notifyUI?: (sessionId: string) => void;
}

// ToolContext 构造函数参数类型
export interface ToolContextParams {
  aiConfig: ToolAIConfig;
  sessionId: string | null;
  triggerSource?: string;
  triggerReason?: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  capabilities?: string[];
  repositories: ToolRepositories;
  callbacks?: ToolCallbacks;
  sharedState?: Record<string, any>;
  /** Agent Runtime 当前工具执行的协作式取消信号；非 Agent 调用方可以不提供。 */
  abortSignal?: AbortSignal;
}

// 运行时快照类型
export interface ToolRuntimeSnapshot {
  actorAIId: string | null;
  actorAgentId: string | null;
  actorName: string | null;
  isHost: boolean;
  isBlocked: boolean;
  triggerSource: string;
  triggerReason: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  capabilities: string[];
}

/**
 * 工具执行上下文类
 * 通过构造函数注入所有依赖，实现依赖倒置
 */
export class ToolContext {
  aiConfig: ToolAIConfig;
  sessionId: string | null;
  triggerSource: string;
  triggerReason: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  capabilities: string[];
  repositories: ToolRepositories;
  onError: (message: string) => void;
  notifyUI: (sessionId: string) => void;
  sharedState: Record<string, any>;
  abortSignal?: AbortSignal;

  constructor({
    aiConfig,
    sessionId,
    triggerSource,
    triggerReason,
    relatedEntityType,
    relatedEntityId,
    capabilities,
    repositories,
    callbacks,
    sharedState,
    abortSignal,
  }: ToolContextParams) {
    this.aiConfig = aiConfig;
    this.sessionId = sessionId;
    this.triggerSource = triggerSource || 'unknown';
    this.triggerReason = triggerReason || 'unknown';
    this.relatedEntityType = relatedEntityType || null;
    this.relatedEntityId = relatedEntityId || null;
    this.capabilities = Array.isArray(capabilities) ? capabilities : [];
    this.repositories = repositories;
    this.onError = callbacks?.onError || (() => {});
    this.notifyUI = callbacks?.notifyUI || (() => {});
    this.sharedState = sharedState || {};
    this.abortSignal = abortSignal;
  }

  /**
   * 获取 AI ID
   */
  getAIId(): string | undefined {
    return this.aiConfig.id;
  }

  /**
   * 获取 AI 名称
   */
  getAIName(): string | undefined {
    return this.aiConfig.name;
  }

  /**
   * 获取稳定 agentId
   */
  getAgentId(): string | undefined {
    return this.aiConfig.agentId;
  }

  /**
   * 判断是否为主理AI
   */
  isHostAI(): boolean {
    return this.aiConfig.isHostAI === true;
  }

  /**
   * 判断是否被拉黑
   */
  isBlocked(): boolean {
    return this.aiConfig.isBlocked === true;
  }

  getTriggerSource(): string {
    return this.triggerSource;
  }

  getTriggerReason(): string {
    return this.triggerReason;
  }

  getRelatedEntityType(): string | null {
    return this.relatedEntityType;
  }

  getRelatedEntityId(): string | null {
    return this.relatedEntityId;
  }

  getCapabilities(): string[] {
    return [...this.capabilities];
  }

  hasCapability(capability: string): boolean {
    return this.capabilities.includes(capability);
  }

  getRuntimeSnapshot(): ToolRuntimeSnapshot {
    return {
      actorAIId: this.getAIId() || null,
      actorAgentId: this.getAgentId() || null,
      actorName: this.getAIName() || null,
      isHost: this.isHostAI(),
      isBlocked: this.isBlocked(),
      triggerSource: this.getTriggerSource(),
      triggerReason: this.getTriggerReason(),
      relatedEntityType: this.getRelatedEntityType(),
      relatedEntityId: this.getRelatedEntityId(),
      capabilities: this.getCapabilities(),
    };
  }

  buildExplanationText(): string {
    const snapshot = this.getRuntimeSnapshot();
    const actorName = snapshot.actorName || '未知AI';
    const actorAgentId = snapshot.actorAgentId || '未绑定';
    const sourceLabel = this.#describeTriggerSource(snapshot.triggerSource);
    const reasonLabel = this.#describeTriggerReason(snapshot.triggerReason);
    const entityLabel = this.#describeRelatedEntity(
      snapshot.relatedEntityType,
      snapshot.relatedEntityId
    );
    const capabilityLabel =
      snapshot.capabilities.length > 0
        ? snapshot.capabilities.join(', ')
        : '未声明额外能力';

    return [
      '【当前运行上下文】',
      `- 你当前扮演的AI：${actorName}`,
      `- 你的稳定身份ID：${actorAgentId}`,
      `- 当前触发来源：${sourceLabel}`,
      `- 当前触发原因：${reasonLabel}`,
      `- 当前关联对象：${entityLabel}`,
      `- 当前能力边界：${capabilityLabel}`,
      '- 上述内容用于解释你为什么会被唤起，不代表这些话是用户在聊天框里直接输入的。',
      '- 回复或执行动作时，应优先围绕当前关联对象，不要擅自扩展到无关对象。',
    ].join('\n');
  }

  #describeTriggerSource(triggerSource: string): string {
    const sourceMap: Record<string, string> = {
      chat: '聊天会话（chat）',
      ledger: '羽库记账自动触发（ledger）',
      moments: '时刻动态触发（moments）',
      host: '主理AI管理链路（host）',
      raven_cat_wake: 'RavenCat Self Wake 自主运行（raven_cat_wake）',
      raven_cat_ai_schedule: 'RavenCat AI Schedule 自主运行（raven_cat_ai_schedule）',
      diary: '日记链路（diary）【已移除该功能】',
    };

    return sourceMap[triggerSource] || `未知来源（${triggerSource || 'unknown'}）`;
  }

  #describeTriggerReason(triggerReason: string): string {
    const reasonMap: Record<string, string> = {
      user_message: '用户刚发送了一条聊天消息',
      user_message_batch: '用户在短时间内连续发送了多条聊天消息',
      new_records_batch: '用户刚新增了一批记账记录',
      moment_auto_comment: '系统正在为指定时刻生成自动评论',
      moment_manual_comment: '用户手动要求你为指定时刻生成评论',
      moment_auto_interaction: '系统正在为指定时刻执行自动互动',
      moment_manual_interaction: '用户手动要求你与指定时刻互动',
      self_wake: '主理 AI 的 Self Wake 已取得本次行动机会',
      ai_schedule: '主理 AI 的一条 AI Schedule 已到期并取得本次行动机会',
    };

    return reasonMap[triggerReason] || `未命名原因（${triggerReason || 'unknown'}）`;
  }

  #describeRelatedEntity(
    relatedEntityType: string | null,
    relatedEntityId: string | null
  ): string {
    if (!relatedEntityType && !relatedEntityId) {
      return '无明确关联对象';
    }

    const typeMap: Record<string, string> = {
      message: '聊天消息',
      message_batch: '聊天消息批次',
      ledger_record_batch: '记账记录批次',
      moment: '时刻动态',
      moment_comment_draft: '时刻评论草稿',
      raven_cat_self_wake: 'Self Wake',
      raven_cat_ai_schedule: 'AI Schedule',
    };

    const typeLabel = typeMap[relatedEntityType || ''] || relatedEntityType || '未知对象';
    return relatedEntityId ? `${typeLabel}（${relatedEntityId}）` : typeLabel;
  }
}
