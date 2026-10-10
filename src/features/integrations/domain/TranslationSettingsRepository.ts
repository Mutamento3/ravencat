export interface TranslationSettingsRepository {
  getModelId(): Promise<string | null>;
  setModelId(modelConfigId: string | null): Promise<void>;
}
