/** AI 助手持久化端口。 */
import type { DatabaseTransactionExecutor } from '@platform/persistence';
import type { AIProfile } from './AIProfile';

/** Host M3b 头像迁移只读取 AI owner 的 legacy URI。 */
export interface AIAvatarMediaAssetMigrationCandidate {
  id: string;
  avatar: string;
  avatarMediaAssetId: string | null;
}

export interface CommitAIAvatarMediaAssetReferenceInput {
  ownerId: string;
  expectedAvatar: string | null;
  expectedAvatarMediaAssetId: string | null;
  mediaAssetId: string;
}

export interface AIAvatarMediaAssetReference {
  avatar: string | null;
  avatarMediaAssetId: string | null;
}

/** 列表与主理关系界面使用的轻量投影，不携带模型密钥、Prompt 或生成参数。 */
export interface AIAssistantSummary {
  /** 对应 AIProfile.id 的 Assistant 实体主键。 */
  readonly id: string;
  /** 对应 AIProfile.agentId 的不可变 actor key。 */
  readonly agentId: string;
  name: string;
  avatar: string | null;
  avatarMediaAssetId: string | null;
  model: string;
  isHostAI: boolean;
  canonicalConversationId: string | null;
  isBlocked: boolean;
}

/** 对话设置拥有展示信息、人设与消息呈现策略，不接受身份键。 */
export type AIAssistantSettingsUpdate = Partial<Pick<
  AIProfile,
  'name' | 'avatar' | 'avatarMediaAssetId' | 'systemPrompt' | 'allowMultipleBubbles'
>>;

/** 角色模型页只拥有调用配置；身份、名称、头像和人设由各自入口维护。 */
export type AIModelSettingsUpdate = Partial<Pick<AIProfile,
  'model' | 'apiKey' | 'apiBaseUrl' | 'temperature' | 'topP' | 'maxTokens'
  | 'privateContextPrimaryLimit' | 'privateContextSecondaryLimit'
  | 'groupContextPrimaryLimit' | 'groupContextSecondaryLimit'
  | 'enableTools' | 'allowMultipleBubbles' | 'disableThinking'
>>;

/**
 * 删除 AI 助手的结果。
 *
 * mediaAssetCandidates 是「本次删除事务真正带走的 media asset 引用」候选：AI 头像，以及
 * 随 identity 级联删除的 direct 会话消息里引用的媒体。候选必须在删除事实的同一个事务内
 * 收集，调用方只在 deleted 为 true 时才拿它做 targeted release。
 */
export interface AIAssistantDeletionResult {
  deleted: boolean;
  mediaAssetCandidates: readonly string[];
}

export interface IAIAssistantRepository {
  getAll(): Promise<AIProfile[]>;
  listSummaries(): Promise<AIAssistantSummary[]>;
  getById(assistantId: string): Promise<AIProfile | null>;
  getLedgerAI(): Promise<AIProfile | null>;
  getHostAI(): Promise<AIProfile | null>;
  getHostSummary(): Promise<AIAssistantSummary | null>;
  setLedgerAI(aiId: string | null): Promise<boolean>;
  insert(aiAssistant: AIProfile): Promise<AIProfile>;
  updateModelSettings(assistantId: string, settings: AIModelSettingsUpdate): Promise<AIProfile>;
  updateSettings(assistantId: string, settings: AIAssistantSettingsUpdate): Promise<boolean>;
  /**
   * 删除 AI 并在同一事务内返回本次删除带走的 media asset 引用候选。
   */
  delete(assistantId: string): Promise<AIAssistantDeletionResult>;
  getAvatarMediaAssetReference(ownerId: string): Promise<AIAvatarMediaAssetReference | null>;
  listAvatarMediaAssetMigrationCandidates(): Promise<AIAvatarMediaAssetMigrationCandidate[]>;
  getAvatarMediaAssetMigrationCandidate(
    ownerId: string,
  ): Promise<AIAvatarMediaAssetMigrationCandidate | null>;
  commitAvatarMediaAssetReferenceInTransaction(
    transaction: DatabaseTransactionExecutor,
    input: CommitAIAvatarMediaAssetReferenceInput,
  ): Promise<void>;
}
