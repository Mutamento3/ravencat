import type {
  AuxiliaryModelConfig,
  CapabilityKind,
  CreateAuxiliaryModelConfigInput,
  UpdateAuxiliaryModelConfigInput,
} from './AuxiliaryModel';

export interface IAuxiliaryModelRepository {
  listModelConfigs(params?: { capabilityKind?: CapabilityKind }): Promise<AuxiliaryModelConfig[]>;
  getModelConfigById(id: string): Promise<AuxiliaryModelConfig | null>;
  insertModelConfig(input: CreateAuxiliaryModelConfigInput): Promise<AuxiliaryModelConfig>;
  updateModelConfig(id: string, input: UpdateAuxiliaryModelConfigInput): Promise<AuxiliaryModelConfig>;
  deleteModelConfig(id: string): Promise<boolean>;
}
