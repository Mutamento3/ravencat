/** 选择由 Memory 持久化，原有模型同步流程负责更新向量。 */
import React from 'react';
import { ConfiguredModelPicker } from '@shared/ui';
import { getMemoryEmbeddingModelSettings, selectMemoryEmbeddingModel } from '../application/MemoryEmbeddingModels';
import { subscribeMemoryChanged } from '../application/MemorySignals';
export default function MemoryEmbeddingModelPicker({ onManageModels }: { onManageModels(): void }) {
  return <ConfiguredModelPicker title="向量化模型" description="所有记忆空间共用；切换后自动更新向量。不使用时仍可保存记忆和按关键词检索。"
    getSettings={getMemoryEmbeddingModelSettings} onSelect={selectMemoryEmbeddingModel}
    subscribeChanged={subscribeMemoryChanged} onManageModels={onManageModels} />;
}
