/**
 * @fileoverview OpenAIClient - OpenAI 兼容的 AI 客户端
 *
 * 提供 OpenAI 兼容客户端和相关工具函数。
 *
 * @module platform/ai/OpenAIClient
 */

import { BaseAIClient } from './BaseAIClient';
import { KimiClient } from './KimiClient';
import type { AIClientConfig } from './types';

export class OpenAIClient extends BaseAIClient {}

interface AIAssistantConfig {
  baseURL?: string;
  apiBaseUrl?: string;
  apiKey: string;
  model: string;
  temperature?: number | null;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  disableThinking?: boolean;
}

function resolveBaseURL(aiAssistant: AIAssistantConfig): string {
  return aiAssistant.baseURL || aiAssistant.apiBaseUrl || 'https://api.openai.com';
}

/**
 * 创建 AI 客户端的工厂函数
 * 根据 AI 助手配置创建对应客户端
 *
 * @param aiAssistant - AI 助手配置
 * @returns AI 客户端实例
 */
export function createAIClient(aiAssistant: AIAssistantConfig): BaseAIClient {
  const baseURL = resolveBaseURL(aiAssistant);
  const config: AIClientConfig = {
    baseURL,
    apiKey: aiAssistant.apiKey,
    model: aiAssistant.model,
    // 未配置或明确留空都交给服务商决定，不能补成本地采样默认值。
    temperature: aiAssistant.temperature,
    maxTokens: aiAssistant.maxTokens === undefined ? 2000 : aiAssistant.maxTokens,
    topP: aiAssistant.topP,
    systemPrompt: aiAssistant.systemPrompt,
    disableThinking: aiAssistant.disableThinking,
  };

  if (baseURL.includes('moonshot') || baseURL.includes('kimi')) {
    return new KimiClient(config);
  }

  return new OpenAIClient(config);
}

export { fetchModelList } from './modelDiscovery';
export { getErrorDisplayInfo } from './errorMapping';
