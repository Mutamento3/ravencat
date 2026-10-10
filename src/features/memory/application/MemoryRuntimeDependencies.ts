/** Memory 的应用端口；Host 负责模型解析与外部 AI 调用。 */
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { MemorySpaceDescriptor } from '../domain/Memory';
import type { MemoryEmbeddingModel, MemoryRepository } from '../domain/MemoryRepository';

export class MemoryEmbeddingError extends Error {
  constructor(message: string, readonly terminal: boolean) { super(message); }
}
export interface MemoryEmbeddingModelChoice {
  id: string;
  name: string;
  model: string;
}
export interface MemoryEmbeddingModelSettings {
  models: MemoryEmbeddingModelChoice[];
  selectedModelId: string | null;
  selectedModelName: string | null;
  status: 'unconfigured' | 'active' | 'unavailable';
  unavailableReason: string | null;
}
export interface MemoryRuntimeDependencies {
  repository: MemoryRepository;
  listMemorySpaces(): Promise<MemorySpaceDescriptor[]>;
  resolveMemorySpace(assistantId: string): Promise<MemorySpaceDescriptor>;
  resolveEmbeddingModel(): Promise<MemoryEmbeddingModel | null>;
  getEmbeddingModelSettings(): Promise<MemoryEmbeddingModelSettings>;
  selectEmbeddingModel(modelConfigId: string | null): Promise<void>;
  embed(text: string, model: MemoryEmbeddingModel, signal: AbortSignal): Promise<number[]>;
}
const slot = createRuntimeSlot<MemoryRuntimeDependencies>('Memory');
export function configureMemoryRuntimeDependencies(dependencies: MemoryRuntimeDependencies): void { slot.configure(dependencies); }
export function getMemoryRuntimeDependencies(): MemoryRuntimeDependencies { return slot.get(); }
