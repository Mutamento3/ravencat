/**
 * @fileoverview AI 连接测试与工具支持检测
 *
 * 将连接可用性测试、工具支持检测从客户端主文件中拆出，
 * 并统一通过客户端工厂创建实例，避免此文件直接耦合具体客户端类。
 *
 * @module platform/ai/connectionTest
 */

import { createAIClient } from './OpenAIClient';
import type { ConnectionTestResult, ConnectionTestOptions, ToolDefinition } from './types';

interface TestClientOptions {
  disableThinking?: boolean;
  skipParams?: boolean;
  temperature?: number | null;
  maxTokens?: number;
  topP?: number | null;
}

function createTestClient(
  baseURL: string,
  apiKey: string,
  model: string,
  options: TestClientOptions = {}
) {
  return createAIClient({
    baseURL,
    apiKey,
    model: model || 'test-model',
    temperature: options.skipParams ? null : options.temperature,
    maxTokens: options.skipParams ? null : (options.maxTokens ?? 2000),
    topP: options.skipParams ? null : options.topP,
    disableThinking: options.disableThinking,
  });
}

/**
 * 测试 API 连接
 * @param baseURL - API 基础 URL
 * @param apiKey - API Key
 * @param model - 模型名称（可选，用于实际测试调用）
 * @param options - 可选参数
 * @returns 连接测试结果
 */
export async function testAPIConnection(
  baseURL: string,
  apiKey: string,
  model?: string,
  options: ConnectionTestOptions = {}
): Promise<ConnectionTestResult> {
  try {
    const client = createTestClient(baseURL, apiKey, model || '', options);

    return await client.testConnection();
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * 检测模型是否支持工具调用
 * @param baseURL - API 基础 URL
 * @param apiKey - API Key
 * @param model - 模型名称
 * @param options - 可选参数
 * @returns 是否支持工具调用
 */
export async function detectToolsSupport(
  baseURL: string,
  apiKey: string,
  model: string,
  options: ConnectionTestOptions = {}
): Promise<boolean> {
  try {
    const client = createTestClient(baseURL, apiKey, model, options);

    const testTool: ToolDefinition = {
      type: 'function',
      function: {
        name: 'test_function',
        description: 'A test function to check if tools are supported',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string' },
          },
          required: ['query'],
        },
      },
    };

    const response = await client.chatWithTools(
      [{ role: 'user', content: 'Hello' }],
      [testTool],
      { toolChoice: 'none' }
    );

    return response.success;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (
      errorMessage.includes('tools is not supported') ||
      errorMessage.includes('function calling is not supported') ||
      (errorMessage.includes('Invalid parameter') && errorMessage.includes('tools')) ||
      errorMessage.includes('does not support tools') ||
      (errorMessage.includes('unknown field') && errorMessage.includes('tools'))
    ) {
      return false;
    }

    console.warn('[detectToolsSupport] Test failed:', errorMessage);
    return false;
  }
}
