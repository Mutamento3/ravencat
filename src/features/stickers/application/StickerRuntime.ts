/** Sticker Feature 的运行时依赖槽，具体装配只由 Host composition 负责。 */

import type {
  CommitMediaAssetReferenceInput,
  CreateMediaAssetInput,
  CreateMediaAssetResult,
  ResolvedMediaAsset,
} from '@features/media';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';
import type { StickerRepository } from '../domain/StickerRepository';
import type {
  StickerModelConfigRef,
  StickerModelRequirementKind,
} from '../domain/StickerSystemConfig';

/** Sticker 只依赖 MediaAsset 稳定公共能力，不接触 backing 或具体仓储。 */
export interface StickerMediaGateway {
  createMediaAssetWithReference<T>(
    input: CreateMediaAssetInput,
    commitReference: (input: CommitMediaAssetReferenceInput) => Promise<T>,
  ): Promise<CreateMediaAssetResult<T>>;
  resolveMediaAsset(assetId: string): Promise<ResolvedMediaAsset>;
  /** 业务事实提交后的 targeted release；候选之外的资产不由 Sticker 触发裁决。 */
  releaseMediaAssetCandidates(assetIds: readonly (string | null | undefined)[]): Promise<void>;
}

/**
 * 辅助模型中心配置的只读访问端口。Sticker System 只引用模型配置 ID，
 * Base URL / API Key / model name 仍由辅助模型中心唯一持有；实现位于 Host。
 */
export interface StickerAuxiliaryModelsGateway {
  getModelConfigById(id: string): Promise<StickerModelConfigRef | null>;
  listModelConfigsByRequirement(
    requirement: StickerModelRequirementKind,
  ): Promise<StickerModelConfigRef[]>;
}

/**
 * embedding 请求端口。实现（Host）按传入的模型引用即时创建 AIClient，
 * 不缓存第二份连接配置；调用方负责先通过 resolver 得到有效模型引用。
 */
export interface StickerEmbeddingGateway {
  embedTexts(
    texts: readonly string[],
    model: StickerModelConfigRef,
    signal: AbortSignal,
  ): Promise<number[][]>;
}

export interface StickerRuntimeDependencies {
  repository: StickerRepository;
  media: StickerMediaGateway;
  auxiliaryModels: StickerAuxiliaryModelsGateway;
  embeddings: StickerEmbeddingGateway;
  generateId: () => string;
  now: () => string;
}

const stickerRuntimeSlot = createRuntimeSlot<StickerRuntimeDependencies>('Sticker');

export function configureStickersRuntime(
  dependencies: StickerRuntimeDependencies,
): void {
  stickerRuntimeSlot.configure(dependencies);
}

export function configureStickerRuntimeDependencies(
  dependencies: StickerRuntimeDependencies,
): void {
  configureStickersRuntime(dependencies);
}

export function getStickersRuntimeDependencies(): StickerRuntimeDependencies {
  return stickerRuntimeSlot.get();
}

export function getStickerRuntimeDependencies(): StickerRuntimeDependencies {
  return getStickersRuntimeDependencies();
}
