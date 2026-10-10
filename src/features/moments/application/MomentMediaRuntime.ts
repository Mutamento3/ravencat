/** Moment Media 的窄运行时：只装配原子发布、辅助模型读取与单图理解依赖。 */
import type { prepareMediaAssetBatch, CreateMediaAssetInput } from '@features/media';
import type { CoordinatedDatabaseExecutor } from '@platform/persistence';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { IMomentRepository } from '../domain/MomentRepository';
import type { MomentImageAnalysisModelRef } from '../domain/MomentImageAnalysis';

export interface MomentImageAnalysisRequest {
  mediaAssetId: string;
  model: MomentImageAnalysisModelRef;
  signal?: AbortSignal;
}

export type MomentImageAnalysisExecutor = (
  request: MomentImageAnalysisRequest
) => Promise<string>;

export interface MomentMediaRuntimeDependencies {
  repository: IMomentRepository;
  database: Pick<CoordinatedDatabaseExecutor, 'withExclusiveTransactionAsync'>;
  prepareMedia: (inputs: readonly CreateMediaAssetInput[]) => ReturnType<typeof prepareMediaAssetBatch>;
  auxiliaryModels: {
    getById(id: string): Promise<MomentImageAnalysisModelRef | null>;
    listOcr(): Promise<MomentImageAnalysisModelRef[]>;
  };
  executeImageAnalysis: MomentImageAnalysisExecutor;
  now: () => string;
}

const slot = createRuntimeSlot<MomentMediaRuntimeDependencies>('MomentMedia');

export function configureMomentMediaRuntime(dependencies: MomentMediaRuntimeDependencies): void {
  slot.configure(dependencies);
}

export function getMomentMediaRuntime(): MomentMediaRuntimeDependencies {
  return slot.get();
}
