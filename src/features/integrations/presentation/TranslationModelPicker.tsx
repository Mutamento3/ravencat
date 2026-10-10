/** 选择直接嵌入资产列表，业务引用仍由 Integrations 保存。 */
import React from 'react';
import { ConfiguredModelPicker } from '@shared/ui';
import { getTranslationModelSettings, selectTranslationModel, subscribeTranslationModelsChanged } from '../application/TranslationModels';

export default function TranslationModelPicker() {
  return <ConfiguredModelPicker title="聊天翻译模型" description="单聊和群聊共用此选择。"
    getSettings={getTranslationModelSettings} onSelect={selectTranslationModel}
    subscribeChanged={subscribeTranslationModelsChanged} />;
}
