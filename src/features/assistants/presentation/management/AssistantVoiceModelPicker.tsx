import React, { useCallback } from 'react';
import { ConfiguredModelPicker } from '@shared/ui';
import { getAssistantVoiceModelSettings, selectAssistantVoiceModel, subscribeAssistantVoiceModelsChanged } from '../../application/AssistantVoiceModels';

export function AssistantVoiceModelPicker({ assistantId, onManageModels }: { assistantId: string; onManageModels(): void }) {
  const getSettings = useCallback(() => getAssistantVoiceModelSettings(assistantId), [assistantId]);
  const onSelect = useCallback((id: string | null) => selectAssistantVoiceModel(assistantId, id), [assistantId]);
  return <ConfiguredModelPicker title="角色语音模型" description="仅供当前角色的语音消息和通话使用。"
    getSettings={getSettings} onSelect={onSelect} subscribeChanged={subscribeAssistantVoiceModelsChanged} onManageModels={onManageModels} />;
}
