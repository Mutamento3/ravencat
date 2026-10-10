/** Sticker System 业务级模型选择的查询与命令。 */

import type {
  StickerModelConfigRef,
  StickerModelRequirementKind,
  StickerModelSelection,
  StickerSystemConfig,
} from '../domain/StickerSystemConfig';
import {
  evaluateStickerModelConfig,
  evaluateStickerModelSelection,
} from '../domain/StickerSystemConfig';
import { emitStickerAnnotationPending } from './StickerAnnotationPendingSignal';
import { emitStickerEmbeddingPending } from './StickerEmbeddingPendingSignal';
import { getStickersRuntimeDependencies } from './StickerRuntime';

const STICKER_SYSTEM_CONFIG_ID = 'global' as const;

export async function getStickerSystemConfig(): Promise<StickerSystemConfig> {
  const runtime = getStickersRuntimeDependencies();
  const stored = await runtime.repository.getStickerSystemConfig();
  return (
    stored ?? {
      recognitionModelConfigId: null,
      embeddingModelConfigId: null,
      updatedAt: runtime.now(),
    }
  );
}

/** Recognition 只接受 enabled 的 ocr 类模型配置；Embedding 只接受 enabled 的 embedding 配置。 */
async function requireValidModelConfig(
  modelConfigId: string,
  requirement: StickerModelRequirementKind,
): Promise<StickerModelConfigRef> {
  const runtime = getStickersRuntimeDependencies();
  const config = await runtime.auxiliaryModels.getModelConfigById(modelConfigId);
  const valid = evaluateStickerModelConfig(config, requirement);
  if (!valid) {
    throw new Error(
      requirement === 'ocr'
        ? '视觉识别模型必须选择辅助模型中心已启用的 ocr 类模型'
        : '向量化模型必须选择辅助模型中心已启用的 embedding 类模型',
    );
  }
  return valid;
}

/**
 * 设置识别模型。持久化成功后立刻发出标注 pending 信号：worker 会自行判断是否
 * 真的有 pending 任务，因此这里不需要先查库；这样已经积压的标注不必等到
 * pathname 变化、重新前台或冷启动才恢复。清空配置不发信号，避免没有模型时
 * 反复唤醒 worker。任何模型请求都只发生在 worker 里，不在保存事务内。
 */
export async function setStickerRecognitionModel(
  modelConfigId: string | null,
): Promise<StickerSystemConfig> {
  const normalized = modelConfigId?.trim() || null;
  if (normalized) {
    await requireValidModelConfig(normalized, 'ocr');
  }
  const saved = await saveStickerSystemConfig({ recognitionModelConfigId: normalized });
  if (normalized) {
    emitStickerAnnotationPending();
  }
  return saved;
}

/** 设置向量化模型；持久化成功后立刻发出 embedding 队列信号触发补建 / 重建。 */
export async function setStickerEmbeddingModel(
  modelConfigId: string | null,
): Promise<StickerSystemConfig> {
  const normalized = modelConfigId?.trim() || null;
  if (normalized) {
    await requireValidModelConfig(normalized, 'embedding');
  }
  const saved = await saveStickerSystemConfig({ embeddingModelConfigId: normalized });
  if (normalized) {
    emitStickerEmbeddingPending();
  }
  return saved;
}

async function saveStickerSystemConfig(
  patch: Partial<Pick<StickerSystemConfig, 'recognitionModelConfigId' | 'embeddingModelConfigId'>>,
): Promise<StickerSystemConfig> {
  const runtime = getStickersRuntimeDependencies();
  const current = await getStickerSystemConfig();
  const next: StickerSystemConfig = {
    recognitionModelConfigId: patch.recognitionModelConfigId === undefined
      ? current.recognitionModelConfigId
      : patch.recognitionModelConfigId,
    embeddingModelConfigId: patch.embeddingModelConfigId === undefined
      ? current.embeddingModelConfigId
      : patch.embeddingModelConfigId,
    updatedAt: runtime.now(),
  };
  await runtime.repository.saveStickerSystemConfig(next, next.updatedAt);
  return next;
}

export async function listStickerModelCandidates(
  requirement: StickerModelRequirementKind,
): Promise<StickerModelConfigRef[]> {
  const runtime = getStickersRuntimeDependencies();
  // picker 只显示 enabled 且 capabilityKind 匹配的模型；创建模型仍属于辅助模型中心。
  const configs = await runtime.auxiliaryModels.listModelConfigsByRequirement(requirement);
  return configs.filter((config) => config.enabled);
}

/**
 * 当前绑定模型的展示投影：presentation 只消费这一层，不直接访问 repository 或
 * 辅助模型中心。它与 picker 的 candidate list 是两件独立的事——candidate 只在
 * 用户打开 picker 后才加载，用它反查已配置模型会让首次进入页面显示成
 * “所选模型不可用”，而且 recognition / embedding 共用一个 state 时互相污染。
 * 这里分别解析两个绑定，任何一个都只反映自己的状态。
 */
export interface StickerSystemModelSelection {
  recognition: StickerModelSelection;
  embedding: StickerModelSelection;
}

export async function getStickerSystemModelSelection(): Promise<StickerSystemModelSelection> {
  const runtime = getStickersRuntimeDependencies();
  const config = await getStickerSystemConfig();
  const [recognitionConfig, embeddingConfig] = await Promise.all([
    config.recognitionModelConfigId
      ? runtime.auxiliaryModels.getModelConfigById(config.recognitionModelConfigId)
      : null,
    config.embeddingModelConfigId
      ? runtime.auxiliaryModels.getModelConfigById(config.embeddingModelConfigId)
      : null,
  ]);
  return {
    recognition: evaluateStickerModelSelection(
      config.recognitionModelConfigId,
      recognitionConfig,
      'ocr',
    ),
    embedding: evaluateStickerModelSelection(
      config.embeddingModelConfigId,
      embeddingConfig,
      'embedding',
    ),
  };
}

/**
 * Sticker-owned recognition resolver：只读取 Sticker 业务配置里的模型 ID，
 * 不读取 OCR capability binding，也不读取 OCR task prompt；
 * prompt 与 JSON contract 由 Sticker Recognition Gateway 注入。
 * 未配置或失效返回 null，annotation worker 不领取新任务、不循环刷错误。
 */
export async function resolveStickerRecognitionModel(): Promise<StickerModelConfigRef | null> {
  const config = await getStickerSystemConfig();
  if (!config.recognitionModelConfigId) return null;
  const runtime = getStickersRuntimeDependencies();
  const model = await runtime.auxiliaryModels.getModelConfigById(config.recognitionModelConfigId);
  return evaluateStickerModelConfig(model, 'ocr');
}

/** embedding resolver：模型必须存在、enabled 且 capabilityKind 为 embedding。 */
export async function resolveStickerEmbeddingModel(): Promise<StickerModelConfigRef | null> {
  const config = await getStickerSystemConfig();
  if (!config.embeddingModelConfigId) return null;
  const runtime = getStickersRuntimeDependencies();
  const model = await runtime.auxiliaryModels.getModelConfigById(config.embeddingModelConfigId);
  return evaluateStickerModelConfig(model, 'embedding');
}

export { STICKER_SYSTEM_CONFIG_ID };
