/** 可复制的模型调用参数；不包含身份、人设、上下文或工具授权。 */
export interface ModelCallConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number | null;
  topP: number | null;
  maxTokens: number | null;
}
