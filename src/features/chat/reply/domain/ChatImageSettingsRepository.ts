/** Chat 图片预处理选择，供聊天与通话图片输入共用。 */
export interface ChatImageSettingsRepository {
  getRecognitionModelId(assistantId: string): Promise<string | null>;
  setRecognitionModelId(assistantId: string, modelConfigId: string | null): Promise<void>;
}
