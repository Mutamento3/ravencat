// AddAIScreen 模型列表获取与选择逻辑

import { showAppDialog } from '@shared/ui';
import { useState, useCallback } from 'react';

import { fetchModelsWithConfig } from './sharedModelConfig';

export interface ModelItem {
  id: string;
  name: string;
}

interface UseAddAIModelSelectionOptions {
  apiBaseUrl: string;
  apiKey: string;
  setSelectedModel: (modelId: string) => void;
}

interface UseAddAIModelSelectionResult {
  availableModels: ModelItem[];
  isLoadingModels: boolean;
  showModelPicker: boolean;
  setShowModelPicker: (show: boolean) => void;
  resetModelSelection: () => void;
  handleFetchModels: () => Promise<void>;
  handleSelectModel: (modelId: string) => void;
}

export default function useAddAIModelSelection({
  apiBaseUrl,
  apiKey,
  setSelectedModel,
}: UseAddAIModelSelectionOptions): UseAddAIModelSelectionResult {
  const [availableModels, setAvailableModels] = useState<ModelItem[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [showModelPicker, setShowModelPicker] = useState(false);

  const resetModelSelection = useCallback(() => {
    setAvailableModels([]);
    setShowModelPicker(false);
  }, []);

  const handleFetchModels = useCallback(async () => {
    if (!apiBaseUrl || !apiKey) {
      return;
    }

    setIsLoadingModels(true);

    try {
      const { models, errorInfo } = await fetchModelsWithConfig({
        apiBaseUrl,
        apiKey,
      });

      if (errorInfo) {
        showAppDialog({ title: errorInfo.title, message: errorInfo.message, tone: 'error' });
        console.log('[AddAI] Fetch models failed:', errorInfo.message);
        return;
      }

      setAvailableModels(models);

      if (models.length > 0) {
        setShowModelPicker(true);
      } else {
        showAppDialog({ title: '未获取到模型', message: '当前接口没有返回可用模型，请检查账号权限或接口配置。', tone: 'warning' });
      }
    } finally {
      setIsLoadingModels(false);
    }
  }, [apiBaseUrl, apiKey]);

  const handleSelectModel = useCallback((modelId: string) => {
    setSelectedModel(modelId);
    setShowModelPicker(false);
  }, [setSelectedModel]);

  return {
    availableModels,
    isLoadingModels,
    showModelPicker,
    setShowModelPicker,
    resetModelSelection,
    handleFetchModels,
    handleSelectModel,
  };
}
