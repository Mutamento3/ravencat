/** Memory 拥有系统级向量选择，模型资产与任务调度通过运行时端口连接。 */
import { getMemoryRuntimeDependencies } from './MemoryRuntimeDependencies';

export function getMemoryEmbeddingModelSettings() {
  return getMemoryRuntimeDependencies().getEmbeddingModelSettings();
}

export function selectMemoryEmbeddingModel(modelConfigId: string | null) {
  return getMemoryRuntimeDependencies().selectEmbeddingModel(modelConfigId);
}
