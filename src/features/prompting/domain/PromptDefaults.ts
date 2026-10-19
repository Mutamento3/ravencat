/** 默认视图拥有全局配置；不借用某个 AI 的身份保存默认值。 */
export interface DefaultUserPrompt {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  sortOrder: number;
}

export interface PromptDefaults {
  overrides: Record<string, string>;
  userPrompts: DefaultUserPrompt[];
  toolPermissions: Record<string, boolean>;
  /** 身份池名单属于全局提示词配置；未设置的 AI 默认入选。 */
  agentRegistryExcludedAssistantIds: string[];
}

export interface PromptDefaultsRepository {
  read(): Promise<PromptDefaults>;
  saveOverride(definitionId: string, content: string): Promise<void>;
  resetOverride(definitionId: string): Promise<void>;
  saveUserPrompt(prompt: DefaultUserPrompt): Promise<void>;
  deleteUserPrompt(id: string): Promise<void>;
  reorderUserPrompts(first: DefaultUserPrompt, second: DefaultUserPrompt): Promise<void>;
  setEnabled(key: string, enabled: boolean): Promise<void>;
}
