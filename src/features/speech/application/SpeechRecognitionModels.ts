/** 录音与通话共用 Speech 的明确选择，consumer 不产生额外配置层。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { ModelSelectionSettings } from '@shared/ui/modelSelectionTypes';
import type { SpeechSettingsRepository } from '../domain/SpeechSettingsRepository';

interface Dependencies {
  repository: SpeechSettingsRepository;
  getSelection(modelConfigId: string | null): Promise<ModelSelectionSettings>;
  requireModel(modelConfigId: string): Promise<void>;
}
const slot = createRuntimeSlot<Dependencies>('Speech recognition settings');
const listeners = new Set<() => void>();
export function configureSpeechRecognitionModels(deps: Dependencies): void { slot.configure(deps); }
export function subscribeSpeechRecognitionModelsChanged(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function notifySpeechRecognitionModelsChanged(): void { for (const listener of listeners) listener(); }
export function getSpeechRecognitionModelId(): Promise<string | null> { return slot.get().repository.getRecognitionModelId(); }
export async function getSpeechRecognitionModelSettings(): Promise<ModelSelectionSettings> {
  const deps = slot.get(); return deps.getSelection(await deps.repository.getRecognitionModelId());
}
export async function selectSpeechRecognitionModel(modelConfigId: string | null): Promise<void> {
  const deps = slot.get();
  if (modelConfigId !== null) await deps.requireModel(modelConfigId);
  await deps.repository.setRecognitionModelId(modelConfigId);
  notifySpeechRecognitionModelsChanged();
}
