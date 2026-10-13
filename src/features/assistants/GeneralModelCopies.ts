/** 通用资产与独立配置之间只传递值快照，不保存来源 ID 或同步关系。 */
import type { ModelCallConfig } from './domain/ModelCallConfig';
import type { CreateAuxiliaryModelConfigInput } from './domain/AuxiliaryModel';
import { resolveAuxiliaryModel } from './ResolveAuxiliaryModel';

export function buildGeneralModelCopy(name: string, config: ModelCallConfig): CreateAuxiliaryModelConfigInput {
  return {
    capabilityKind: 'general', name, enabled: true,
    baseUrl: config.apiBaseUrl, apiKey: config.apiKey, model: config.model,
    temperature: config.temperature, topP: config.topP, maxTokens: config.maxTokens,
  };
}

export async function getGeneralModelCopy(modelConfigId: string): Promise<ModelCallConfig> {
  // 用户选择属于边界输入，选择时重读资产，沿用统一可用性判定。
  const model = await resolveAuxiliaryModel({ modelConfigId, capabilityKind: 'general' });
  if (!model) throw new Error('该通用辅助模型已不可用，请重新选择或完善配置。');
  return {
    apiBaseUrl: model.baseURL, apiKey: model.apiKey, model: model.model,
    temperature: model.temperature, topP: model.topP, maxTokens: model.maxTokens,
  };
}
