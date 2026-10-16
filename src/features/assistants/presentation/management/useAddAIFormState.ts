// AddAIScreen 基础表单与保存逻辑

import { showAppDialog } from '@shared/ui';
import { useState, useCallback, useMemo } from 'react';

import { createAIAssistant } from '../../AIAssistantManagement';
import type { ModelCallConfig } from '../../domain/ModelCallConfig';
import {
  buildNewAI,
  getAddAIFormError,
  getCurrentAddAIStep,
} from './addAIFormHelpers';

interface UseAddAIFormStateOptions {
  onAdded?: () => void;
  onBack?: () => void;
}

interface UseAddAIFormStateResult {
  name: string;
  setName: (name: string) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
  currentStep: number;
  handleSave: () => Promise<void>;
  modelParams: Pick<ModelCallConfig, 'temperature' | 'topP' | 'maxTokens'> | undefined;
  fillModelConfig: (config: ModelCallConfig) => void;
}

export default function useAddAIFormState({ onAdded, onBack }: UseAddAIFormStateOptions): UseAddAIFormStateResult {
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [modelParams, setModelParams] = useState<Pick<ModelCallConfig, 'temperature' | 'topP' | 'maxTokens'>>();
  const fillModelConfig = (config: ModelCallConfig) => {
    setApiBaseUrl(config.apiBaseUrl);
    setApiKey(config.apiKey);
    setSelectedModel(config.model);
    setModelParams({ temperature: config.temperature, topP: config.topP, maxTokens: config.maxTokens });
  };

  const currentStep = useMemo(() => getCurrentAddAIStep({
    apiBaseUrl,
    apiKey,
    selectedModel,
  }), [apiBaseUrl, apiKey, selectedModel]);

  const handleSave = useCallback(async () => {
    const validationError = getAddAIFormError({
      name,
      apiBaseUrl,
      apiKey,
      selectedModel,
    });

    if (validationError) {
      showAppDialog({ title: '请补全信息', message: validationError, tone: 'warning' });
      return;
    }

    try {
      const newAI = buildNewAI({
        name,
        selectedModel,
        apiKey,
        apiBaseUrl,
        systemPrompt,
        modelParams,
      });

      await createAIAssistant(newAI);
      onAdded?.();
      onBack?.();
    } catch (error) {
      console.error('Failed to add AI:', error.message);
      showAppDialog({ title: '添加失败', message: '无法保存 AI 助手，请稍后重试。', tone: 'error' });
    }
  }, [
    name,
    apiBaseUrl,
    apiKey,
    selectedModel,
    systemPrompt,
    modelParams,
    onAdded,
    onBack,
  ]);

  return {
    modelParams, fillModelConfig,
    name,
    setName,
    apiKey,
    setApiKey,
    apiBaseUrl,
    setApiBaseUrl,
    selectedModel,
    setSelectedModel,
    systemPrompt,
    setSystemPrompt,
    currentStep,
    handleSave,
  };
}
