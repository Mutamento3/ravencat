/** 模型选择组件只消费展示投影，不持有模型连接信息或业务选择。 */
export interface ModelSelectionSettings {
  models: { id: string; name: string; model: string }[];
  selectedModelId: string | null;
  selectedModelName: string | null;
  status: 'unconfigured' | 'active' | 'unavailable';
  unavailableReason: string | null;
}
