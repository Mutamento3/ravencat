/**
 * @fileoverview 模型发现能力
 *
 * 负责查询 OpenAI 兼容接口的模型列表。
 *
 * @module platform/ai/modelDiscovery
 */

import { redactAIErrorMessage } from './errorMapping';
import { normalizeAIBaseURL } from './baseUrl';
import type { ModelInfo } from './types';

/**
 * 获取模型列表
 * 调用 OpenAI 兼容的 /models 接口获取可用模型
 *
 * @param baseURL - API 基础 URL
 * @param apiKey - API Key
 * @returns 模型列表
 */
export async function fetchModelList(baseURL: string, apiKey: string): Promise<ModelInfo[]> {
  try {
    const url = normalizeAIBaseURL(baseURL);

    const response = await fetch(`${url}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorBody || response.statusText}`);
    }

    const data = await response.json() as { data?: { id?: string }[] };

    return (data.data || [])
      .filter((model): model is { id: string } => model.id && typeof model.id === 'string')
      .map((model): ModelInfo => ({
        id: model.id,
        name: model.id,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    // 展示分类属于调用方；这里仅保留并脱敏外部失败，避免多次映射丢失原因与状态。
    throw new Error(redactAIErrorMessage(error instanceof Error ? error.message : String(error), apiKey));
  }
}
