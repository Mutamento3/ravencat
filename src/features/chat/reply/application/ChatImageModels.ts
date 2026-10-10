/** Chat 按角色拥有图片识别选择；聊天与通话共用，资产查询由 Host 装配。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ModelSelectionSettings } from '@shared/ui/modelSelectionTypes';
import type { ChatOCRModelConfig, ChatRecognitionModelSelection } from './ChatReplyRuntimeDependencies';
import type { ChatImageSettingsRepository } from '../domain/ChatImageSettingsRepository';

interface Dependencies {
  repository: ChatImageSettingsRepository;
  getSelection(modelConfigId: string | null): Promise<ModelSelectionSettings>;
  resolveModel(modelConfigId: string | null): Promise<ChatOCRModelConfig | null>;
  requireModel(modelConfigId: string): Promise<void>;
}
const slot = createRuntimeSlot<Dependencies>('Chat image settings');
const listeners = new Set<() => void>();
export function configureChatImageModels(deps: Dependencies): void { slot.configure(deps); }
export function subscribeChatImageModelsChanged(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function notifyChatImageModelsChanged(): void { for (const listener of listeners) listener(); }
export async function getChatImageModelSettings(assistantId: string): Promise<ModelSelectionSettings> {
  const deps = slot.get(); return deps.getSelection(await deps.repository.getRecognitionModelId(assistantId));
}
export async function selectChatImageModel(assistantId: string, modelConfigId: string | null): Promise<void> {
  const deps = slot.get();
  if (modelConfigId !== null) await deps.requireModel(modelConfigId);
  await deps.repository.setRecognitionModelId(assistantId, modelConfigId);
  notifyChatImageModelsChanged();
}
export async function resolveChatRecognitionModel(assistantId: string): Promise<ChatRecognitionModelSelection> {
  const deps = slot.get();
  const modelConfigId = await deps.repository.getRecognitionModelId(assistantId);
  if (modelConfigId === null) return { status: 'unconfigured' };
  const model = await deps.resolveModel(modelConfigId);
  return model ? { status: 'active', model } : { status: 'unavailable' };
}
