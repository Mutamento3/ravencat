// AddAIScreen 表单校验与保存辅助函数

import { createAIProfile, type AIProfile } from '../../domain/AIProfile';

export const DEFAULT_MAX_TOKENS = 2000;

export function getTrimmedAPIConfig({ apiBaseUrl, apiKey }: { apiBaseUrl: string; apiKey: string }) {
  return {
    apiBaseUrl: apiBaseUrl.trim(),
    apiKey: apiKey.trim(),
  };
}

export function validateAddAIForm({ name, apiBaseUrl, apiKey, selectedModel }: { name: string; apiBaseUrl: string; apiKey: string; selectedModel: string }) {
  return Boolean(
    name.trim()
    && apiBaseUrl.trim()
    && apiKey.trim()
    && selectedModel
  );
}

export function getCurrentAddAIStep({ apiBaseUrl, apiKey, selectedModel }: { apiBaseUrl: string; apiKey: string; selectedModel: string }) {
  if (!apiBaseUrl.trim() || !apiKey.trim()) {
    return 1;
  }

  if (!selectedModel) {
    return 2;
  }

  return 3;
}

export function buildNewAI({
  name,
  selectedModel,
  apiKey,
  apiBaseUrl,
  systemPrompt,
}: {
  name: string;
  selectedModel: string;
  apiKey: string;
  apiBaseUrl: string;
  systemPrompt: string;
}): AIProfile {
  const id = `ai_${Date.now()}`;
  return createAIProfile({
    id,
    agentId: `agent_${id}`,
    name: name.trim(),
    avatar: null,
    model: selectedModel,
    apiKey: apiKey.trim(),
    apiBaseUrl: apiBaseUrl.trim(),
    systemPrompt: systemPrompt.trim() || null,
    maxTokens: DEFAULT_MAX_TOKENS,
    enableTools: false,
    allowMultipleBubbles: true,
  });
}
