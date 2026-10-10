/** 辅助模型资产命令；草稿转换边界负责用户输入，内部增量直接信任端口类型。 */
import { emitAuxiliaryModelsChanged } from './AuxiliaryModelsChanged';
import type { AuxiliaryModelConfig, CapabilityKind, CreateAuxiliaryModelConfigInput, UpdateAuxiliaryModelConfigInput } from './domain/AuxiliaryModel';
import type { IAuxiliaryModelRepository } from './domain/AuxiliaryModelRepository';
import { auxiliaryModelRepository } from './infrastructure/SQLiteAuxiliaryModelRepository';

function getRepository(deps: { repository?: IAuxiliaryModelRepository }): IAuxiliaryModelRepository {
  return deps.repository ?? auxiliaryModelRepository;
}
export async function listAuxiliaryModelConfigs(
  params: { capabilityKind?: CapabilityKind } = {}, deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<AuxiliaryModelConfig[]> {
  return getRepository(deps).listModelConfigs(params);
}
export async function getAuxiliaryModelConfigById(
  params: { id: string }, deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<AuxiliaryModelConfig | null> {
  return getRepository(deps).getModelConfigById(params.id);
}
export async function createAuxiliaryModelConfig(
  params: CreateAuxiliaryModelConfigInput, deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<AuxiliaryModelConfig> {
  const created = await getRepository(deps).insertModelConfig(params);
  emitAuxiliaryModelsChanged();
  return created;
}
export async function updateAuxiliaryModelConfig(
  params: { id: string; settings: UpdateAuxiliaryModelConfigInput }, deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<AuxiliaryModelConfig> {
  const updated = await getRepository(deps).updateModelConfig(params.id, params.settings);
  emitAuxiliaryModelsChanged();
  return updated;
}
export async function deleteAuxiliaryModelConfig(
  params: { id: string }, deps: { repository?: IAuxiliaryModelRepository } = {},
): Promise<boolean> {
  const deleted = await getRepository(deps).deleteModelConfig(params.id);
  emitAuxiliaryModelsChanged();
  return deleted;
}
