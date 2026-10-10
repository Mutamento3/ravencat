/** 只解析调用方明确选择的模型资产，不拥有默认或业务选择。 */
import type { CapabilityKind } from './domain/AuxiliaryModel';
import type { IAuxiliaryModelRepository } from './domain/AuxiliaryModelRepository';
import { auxiliaryModelRepository } from './infrastructure/SQLiteAuxiliaryModelRepository';
import type { ModelSelectionSettings } from '@shared/ui/modelSelectionTypes';
import { getAuxiliaryModelUnavailableReason as evaluate } from './AuxiliaryModelAvailability';

export interface ResolvedAuxiliaryModel {
  capabilityKind: CapabilityKind;
  modelConfigId: string;
  modelConfigName: string;
  modelConfigUpdatedAt: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
  metadataJson: string | null;
}

export async function resolveAuxiliaryModel(
  params: { modelConfigId: string | null; capabilityKind: CapabilityKind },
  deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<ResolvedAuxiliaryModel | null> {
  if (params.modelConfigId === null) return null;
  const config = await (deps.repository ?? auxiliaryModelRepository).getModelConfigById(params.modelConfigId);
  if (evaluate(config, params.capabilityKind) !== null) return null;
  const valid = config!;
  return {
    capabilityKind: valid.capabilityKind, modelConfigId: valid.id, modelConfigName: valid.name,
    modelConfigUpdatedAt: valid.updatedAt, baseURL: valid.baseUrl.trim(), apiKey: valid.apiKey!.trim(),
    model: valid.model.trim(), temperature: valid.temperature, topP: valid.topP,
    maxTokens: valid.maxTokens, metadataJson: valid.metadataJson,
  };
}

/** 当前引用单独读取，不能用候选列表推测已停用或删除的模型。 */
export async function getAuxiliaryModelSelection(
  params: { modelConfigId: string | null; capabilityKind: CapabilityKind },
  deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<ModelSelectionSettings> {
  const repository = deps.repository ?? auxiliaryModelRepository;
  const [configs, selected] = await Promise.all([
    repository.listModelConfigs({ capabilityKind: params.capabilityKind }),
    params.modelConfigId === null ? null : repository.getModelConfigById(params.modelConfigId),
  ]);
  const unavailableReason = params.modelConfigId === null ? null : evaluate(selected, params.capabilityKind);
  return {
    models: configs.filter((config) => evaluate(config, params.capabilityKind) === null)
      .map(({ id, name, model }) => ({ id, name, model })),
    selectedModelId: params.modelConfigId, selectedModelName: selected?.name ?? null,
    status: params.modelConfigId === null ? 'unconfigured' : unavailableReason ? 'unavailable' : 'active',
    unavailableReason,
  };
}

export async function requireAuxiliaryModel(
  modelConfigId: string,
  capabilityKind: CapabilityKind,
): Promise<void> {
  const model = await resolveAuxiliaryModel({ modelConfigId, capabilityKind });
  if (!model) throw new Error('请选择类型匹配且配置可用的辅助模型');
}
