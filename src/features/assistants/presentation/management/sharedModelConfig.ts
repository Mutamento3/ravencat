// chat 模块共享的模型配置底层执行器

import {
  fetchModelsWithConfig as fetchModelsWithAppConfig,
  runConnectionTestByConfig as runConnectionTestWithAppConfig,
} from '../../application/AIModelService';
import type {
  ConnectionTestOptions,
  ConnectionTestResult,
  ErrorDisplayInfo,
  ModelInfo,
} from '../../application/modelTypes';

interface NormalizeModelConfigInput {
  apiBaseUrl?: string;
  apiKey?: string;
}

interface NormalizeModelConfigOutput {
  apiBaseUrl: string;
  apiKey: string;
}

export function normalizeModelConfigInput({ apiBaseUrl = '', apiKey = '' }: NormalizeModelConfigInput): NormalizeModelConfigOutput {
  return {
    apiBaseUrl: apiBaseUrl.trim(),
    apiKey: apiKey.trim(),
  };
}

interface FetchModelsResult {
  skipped: boolean;
  models: ModelInfo[];
  errorInfo: ErrorDisplayInfo | null;
  error?: unknown;
}

interface FetchModelsParams {
  apiBaseUrl: string;
  apiKey: string;
}

export async function fetchModelsWithConfig({ apiBaseUrl, apiKey }: FetchModelsParams): Promise<FetchModelsResult> {
  return fetchModelsWithAppConfig({ apiBaseUrl, apiKey });
}

interface RunConnectionTestParams {
  apiBaseUrl: string;
  apiKey: string;
  selectedModel?: string;
  requestOptions?: ConnectionTestOptions;
}

interface RunConnectionTestResult {
  skipped: boolean;
  success: boolean;
  result?: ConnectionTestResult;
  rawError: string | null;
  errorInfo: ErrorDisplayInfo | null;
  error?: unknown;
}

export async function runConnectionTestByConfig({
  apiBaseUrl,
  apiKey,
  selectedModel,
  requestOptions = {},
}: RunConnectionTestParams): Promise<RunConnectionTestResult> {
  return runConnectionTestWithAppConfig({
    apiBaseUrl,
    apiKey,
    selectedModel,
    requestOptions,
  });
}
