import React, { useCallback } from 'react';
import { ConfiguredModelPicker } from '@shared/ui';
import { getChatImageModelSettings, selectChatImageModel, subscribeChatImageModelsChanged } from '../../reply/application/ChatImageModels';

export function ChatImageModelPicker({ assistantId, onManageModels }: { assistantId: string; onManageModels(): void }) {
  const getSettings = useCallback(() => getChatImageModelSettings(assistantId), [assistantId]);
  const onSelect = useCallback((id: string | null) => selectChatImageModel(assistantId, id), [assistantId]);
  return <ConfiguredModelPicker title="视觉识别模型" description="仅用于当前 AI 的聊天图片和通话摄像头画面。未选择时直接传图，请确认聊天模型支持图片；选择后先识别，再将文字结果交给聊天模型。"
    unconfiguredLabel="直接传图给聊天模型" clearSelectionLabel="直接传图（不使用视觉识别模型）"
    getSettings={getSettings} onSelect={onSelect}
    subscribeChanged={subscribeChatImageModelsChanged} onManageModels={onManageModels} />;
}
