import React from 'react';
import { ConfiguredModelPicker } from '@shared/ui';
import { getSpeechRecognitionModelSettings, selectSpeechRecognitionModel, subscribeSpeechRecognitionModelsChanged } from '../application/SpeechRecognitionModels';

export function SpeechRecognitionModelPicker({ onManageModels }: { onManageModels?: () => void }) {
  return <ConfiguredModelPicker title="语音识别模型" description="所有角色的聊天录音与通话共用；识别用户说了什么。"
    getSettings={getSpeechRecognitionModelSettings} onSelect={selectSpeechRecognitionModel}
    subscribeChanged={subscribeSpeechRecognitionModelsChanged} onManageModels={onManageModels} />;
}
