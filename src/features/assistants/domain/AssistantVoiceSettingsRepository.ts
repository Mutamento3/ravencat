/** 声音属于角色表现；未选择与取消选择均不继承其他角色或全局默认。 */
export interface AssistantVoiceSettingsRepository {
  getModelId(assistantId: string): Promise<string | null>;
  setModelId(assistantId: string, modelConfigId: string | null): Promise<void>;
}
