import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ModelSelectionSettings } from '@shared/ui/modelSelectionTypes';
import type { AssistantVoiceSettingsRepository } from '../domain/AssistantVoiceSettingsRepository';

interface Dependencies {
  repository: AssistantVoiceSettingsRepository;
  getSelection(modelConfigId: string | null): Promise<ModelSelectionSettings>;
  requireModel(modelConfigId: string): Promise<void>;
}
const slot = createRuntimeSlot<Dependencies>('Assistant voice settings');
const listeners = new Set<() => void>();
export function configureAssistantVoiceModels(deps: Dependencies): void { slot.configure(deps); }
export function subscribeAssistantVoiceModelsChanged(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function notifyAssistantVoiceModelsChanged(): void { for (const listener of listeners) listener(); }
export function getAssistantVoiceModelId(assistantId: string): Promise<string | null> { return slot.get().repository.getModelId(assistantId); }
export async function getAssistantVoiceModelSettings(assistantId: string): Promise<ModelSelectionSettings> {
  const deps = slot.get(); return deps.getSelection(await deps.repository.getModelId(assistantId));
}
export async function selectAssistantVoiceModel(assistantId: string, modelConfigId: string | null): Promise<void> {
  const deps = slot.get();
  if (modelConfigId !== null) await deps.requireModel(modelConfigId);
  await deps.repository.setModelId(assistantId, modelConfigId);
  notifyAssistantVoiceModelsChanged();
}
