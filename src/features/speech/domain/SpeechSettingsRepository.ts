export interface SpeechSettingsRepository {
  getRecognitionModelId(): Promise<string | null>;
  setRecognitionModelId(modelConfigId: string | null): Promise<void>;
}
