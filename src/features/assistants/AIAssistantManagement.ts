/** AI 助手增删改查及会话初始化入口。 */
import type { AIProfile } from './domain/AIProfile';
import type {
  AIAssistantSettingsUpdate,
  AIModelSettingsUpdate,
  AIAssistantSummary,
} from './domain/AssistantRepository';
import {
  createMediaAssetWithReference,
  MEDIA_ASSET_STORAGE_BACKEND,
  releaseMediaAssetCandidates,
  resolveMediaAsset,
} from '@features/media';
import type { PersistentAvatarDraft } from '@platform/device/DeviceMediaService';
import { inspectLocalImage } from '@platform/device';
import type { DatabaseTransactionExecutor } from '@platform/persistence';
import { HostRelationshipError } from './domain/HostRepository';
import {
  HostAuthorityCoordinator,
  type CurrentHostAuthorityResult,
} from './application/HostAuthorityCoordinator';
import { aiAssistantRepository } from './infrastructure/SQLiteAssistantRepository';
import { aiHostRepository } from './infrastructure/SQLiteHostRepository';

export interface AssistantChatSessionGateway {
  resolveCanonicalConversation(aiId: string): Promise<{
    id: string;
    lastTime?: string | null;
  }>;
  onHostRelationshipRemoved(
    aiId: string,
    reason: 'revoked' | 'deleted'
  ): Promise<void>;
}

let chatSessionGateway: AssistantChatSessionGateway | null = null;
const hostAuthorityCoordinator = new HostAuthorityCoordinator(aiHostRepository);

export function configureAssistantRuntime(gateway: AssistantChatSessionGateway): void {
  chatSessionGateway = gateway;
}

export async function listAIAssistants(): Promise<AIProfile[]> {
  return aiAssistantRepository.getAll();
}

export async function getAIAssistantById(aiId: string): Promise<AIProfile | null> {
  return aiAssistantRepository.getById(aiId);
}

export async function listAIAssistantSummaries(): Promise<AIAssistantSummary[]> {
  return aiAssistantRepository.listSummaries();
}
export async function applyAssistantContextLimits(assistantIds: readonly string[], settings: import('./domain/AssistantRepository').AssistantContextLimits): Promise<void> {
  await aiAssistantRepository.applyContextLimits(assistantIds, settings);
  for (const id of assistantIds) {
    const assistant = await aiAssistantRepository.getById(id);
    if (assistant) emitAIAssistantUpdated(assistant);
  }
}

export async function deleteAIAssistant(aiId: string): Promise<boolean> {
  return hostAuthorityCoordinator.runHostMutation(async () => {
    const assistant = await aiAssistantRepository.getById(aiId);
    // 引用候选由删除事务自己给出（AI 头像 + identity 级联带走的消息媒体引用）：收集与删除
    // 共享同一个 exclusive transaction，窗口期内新提交的消息引用不会漏出候选集。
    const { deleted, mediaAssetCandidates } = await aiAssistantRepository.delete(aiId);
    if (deleted) {
      await releaseMediaAssetCandidates(mediaAssetCandidates);
    }
    if (deleted && assistant?.isHostAI) {
      await requireChatSessionGateway().onHostRelationshipRemoved(aiId, 'deleted');
    }
    return deleted;
  });
}

export async function createAIAssistant(aiAssistant: AIProfile): Promise<AIProfile> {
  const insertedAI = await aiAssistantRepository.insert(aiAssistant);

  try {
    const conversation = await requireChatSessionGateway()
      .resolveCanonicalConversation(insertedAI.id);
    return {
      ...insertedAI,
      canonicalConversationId: conversation.id,
      lastTime: conversation.lastTime || insertedAI.lastTime,
    };
  } catch (error) {
    // 创建会话失败后回滚这条 AI 行：它的头像引用随行一起消失，候选由删除事务给出。
    const { mediaAssetCandidates } = await aiAssistantRepository.delete(insertedAI.id);
    await releaseMediaAssetCandidates(mediaAssetCandidates);
    throw error;
  }

}

export async function updateAIModelSettings(aiId: string, settings: AIModelSettingsUpdate): Promise<AIProfile> {
  const persisted = await aiAssistantRepository.updateModelSettings(aiId, settings);
  emitAIAssistantUpdated(persisted);
  return persisted;
}

export async function updateAIAssistantSettings(
  aiId: string,
  settings: AIAssistantSettingsUpdate
): Promise<boolean> {
  const replacesAvatar = settings.avatar !== undefined || settings.avatarMediaAssetId !== undefined;
  let previousAvatarMediaAssetId: string | null = null;
  if (replacesAvatar) {
    previousAvatarMediaAssetId =
      (await aiAssistantRepository.getAvatarMediaAssetReference(aiId))?.avatarMediaAssetId ?? null;
  }

  const updated = await aiAssistantRepository.updateSettings(aiId, settings);
  if (updated && replacesAvatar) {
    await releaseMediaAssetCandidates([previousAvatarMediaAssetId]);
  }
  if (updated) {
    const assistant = await aiAssistantRepository.getById(aiId);
    if (assistant) {
      emitAIAssistantUpdated(assistant);
    }
  }
  return updated;
}

/** 头像独立提交，不读取或回写名称草稿。 */
export async function updateAIAssistantAvatarFromDraft(
  aiId: string,
  draft: PersistentAvatarDraft,
): Promise<AIProfile> {
  const expected = await aiAssistantRepository.getAvatarMediaAssetReference(aiId);
  if (!expected) {
    throw new Error(`AI 助手不存在：${aiId}`);
  }
  await createMediaAssetWithReference(
    {
      storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentImage,
      sourceUri: draft.uri,
      fileName: draft.fileName,
      mimeType: draft.mimeType,
      width: draft.width,
      height: draft.height,
      durationMs: null,
    },
    ({ transaction, asset }) => aiAssistantRepository.commitAvatarMediaAssetReferenceInTransaction(
      transaction,
      {
        ownerId: aiId,
        expectedAvatar: expected.avatar,
        expectedAvatarMediaAssetId: expected.avatarMediaAssetId,
        mediaAssetId: asset.id,
      },
    ),
  );
  await releaseMediaAssetCandidates([expected.avatarMediaAssetId]);
  const updated = await aiAssistantRepository.getById(aiId);
  if (!updated) {
    throw new Error(`保存后的 AI 助手不存在：${aiId}`);
  }
  emitAIAssistantUpdated(updated);
  return updated;
}

export type AIAssistantUpdatedListener = (assistant: AIProfile) => void;

/** 工具只传当前执行角色；事务内 fence 与头像 CAS 分别保护运行资格和用户的后续编辑。 */
export async function changeOwnAvatarFromMediaAsset(assistantId: string, mediaAssetId: string, guard: (transaction: DatabaseTransactionExecutor) => Promise<void>) {
  const expected = await aiAssistantRepository.getAvatarMediaAssetReference(assistantId);
  if (!expected) return { changed: false, reason: 'AI 已不存在' };
  const media = await resolveMediaAsset(mediaAssetId);
  await inspectLocalImage(media.localUri);
  const changed = await aiAssistantRepository.replaceAvatarMediaAssetReference({ ownerId: assistantId,
    expectedAvatar: expected.avatar, expectedAvatarMediaAssetId: expected.avatarMediaAssetId, mediaAssetId }, guard);
  if (!changed) return { changed: false, reason: '头像在处理期间已被修改或角色已删除，旧请求未覆盖新设置' };
  await releaseMediaAssetCandidates([expected.avatarMediaAssetId]);
  const assistant = await aiAssistantRepository.getById(assistantId);
  if (assistant) emitAIAssistantUpdated(assistant);
  return { changed: true, mediaAssetId };
}

const aiAssistantUpdatedListeners = new Set<AIAssistantUpdatedListener>();

function emitAIAssistantUpdated(assistant: AIProfile): void {
  for (const listener of aiAssistantUpdatedListeners) {
    listener(assistant);
  }
}

export function subscribeAIAssistantUpdated(
  listener: AIAssistantUpdatedListener,
): () => void {
  aiAssistantUpdatedListeners.add(listener);
  return () => aiAssistantUpdatedListeners.delete(listener);
}

export async function getLedgerAIAssistant(): Promise<AIProfile | null> {
  return aiAssistantRepository.getLedgerAI();
}

export async function setLedgerAIAssistant(aiId: string | null): Promise<boolean> {
  return aiAssistantRepository.setLedgerAI(aiId);
}

export async function getHostAIAssistant(): Promise<AIProfile | null> {
  return aiAssistantRepository.getHostAI();
}

export async function appointHostAIAssistant(aiId: string): Promise<boolean> {
  return hostAuthorityCoordinator.runHostMutation(async () => {
    const assistant = await aiAssistantRepository.getById(aiId);
    if (!assistant) {
      throw new HostRelationshipError('assistant_not_found', '指定的 AI 不存在');
    }
    if (assistant.isBlocked) {
      throw new HostRelationshipError('assistant_blocked', '被限制的 AI 不能成为主理 AI');
    }
    if (!assistant.model.trim()) {
      throw new HostRelationshipError(
        'assistant_model_unconfigured',
        '没有可用聊天模型的 AI 不能成为主理 AI'
      );
    }
    return aiHostRepository.setHostAI(aiId);
  });
}

export async function revokeHostAIAssistant(aiId: string): Promise<boolean> {
  return hostAuthorityCoordinator.runHostMutation(async () => {
    const assistant = await aiAssistantRepository.getById(aiId);
    const revoked = await aiHostRepository.revokeHostAI(aiId);
    if (revoked && assistant?.isHostAI) {
      await requireChatSessionGateway().onHostRelationshipRemoved(aiId, 'revoked');
    }
    return revoked;
  });
}

/** 在当前主理身份仍成立的同一串行边界内完成高权限副作用。 */
export function runAsCurrentHostAuthority<T>(
  actorAiId: string,
  action: () => Promise<T>,
): Promise<CurrentHostAuthorityResult<T>> {
  return hostAuthorityCoordinator.runAsCurrentHost(actorAiId, action);
}

/** 供 Host 恢复出厂等跨 Feature 关系清理复用同一裁决边界。 */
export function runHostAuthorityMutation<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  return hostAuthorityCoordinator.runHostMutation(mutation);
}

export async function getHostAICooldownStatus() {
  const appointment = await aiHostRepository.checkHostCooldown();
  return { appointment };
}

/** 解除开发设备上的关系冷静期，不改变正式产品规则。 */
export async function clearHostAIAppointmentCooldownForDevelopment(): Promise<void> {
  if (!__DEV__) {
    throw new Error('正式构建不允许清除主理 AI 冷静期');
  }
  await aiHostRepository.clearAppointmentCooldownForDevelopment();
}

function requireChatSessionGateway(): AssistantChatSessionGateway {
  if (!chatSessionGateway) {
    throw new Error('助手聊天会话网关尚未配置');
  }
  return chatSessionGateway;
}
