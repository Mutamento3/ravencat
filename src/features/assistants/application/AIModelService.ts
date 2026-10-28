import {
  detectParamError,
  fetchModelList,
  getErrorDisplayInfo,
  testAPIConnection,
} from '@platform/ai';
import type {
  ConnectionTestOptions,
  ConnectionTestResult,
  ErrorDisplayInfo,
  ModelInfo,
  ParamErrorInfo,
} from './modelTypes';

interface NormalizeModelConfigInput {
  apiBaseUrl?: string;
  apiKey?: string;
}

interface NormalizeModelConfigOutput {
  apiBaseUrl: string;
  apiKey: string;
}

export interface FetchModelsWithConfigResult {
  skipped: boolean;
  models: ModelInfo[];
  errorInfo: ErrorDisplayInfo | null;
  error?: unknown;
}

export interface RunConnectionTestByConfigResult {
  skipped: boolean;
  success: boolean;
  result?: ConnectionTestResult;
  rawError: string | null;
  errorInfo: ErrorDisplayInfo | null;
  error?: unknown;
}

export function normalizeModelConfigInput({
  apiBaseUrl = '',
  apiKey = '',
}: NormalizeModelConfigInput): NormalizeModelConfigOutput {
  return {
    apiBaseUrl: apiBaseUrl.trim(),
    apiKey: apiKey.trim(),
  };
}

export async function fetchModelsWithConfig({
  apiBaseUrl,
  apiKey,
}: NormalizeModelConfigInput): Promise<FetchModelsWithConfigResult> {
  const normalizedConfig = normalizeModelConfigInput({ apiBaseUrl, apiKey });

  if (!normalizedConfig.apiBaseUrl || !normalizedConfig.apiKey) {
    return {
      skipped: true,
      models: [],
      errorInfo: null,
    };
  }

  try {
    const models = await fetchModelList(
      normalizedConfig.apiBaseUrl,
      normalizedConfig.apiKey
    );

    return {
      skipped: false,
      models: models as ModelInfo[],
      errorInfo: null,
    };
  } catch (error) {
    return {
      skipped: false,
      models: [],
      error,
      errorInfo: getErrorDisplayInfo(error as Error | string, { includeDetails: true }) as ErrorDisplayInfo,
    };
  }
}

export async function runConnectionTestByConfig({
  apiBaseUrl,
  apiKey,
  selectedModel,
  requestOptions = {},
}: {
  apiBaseUrl: string;
  apiKey: string;
  selectedModel?: string;
  requestOptions?: ConnectionTestOptions;
}): Promise<RunConnectionTestByConfigResult> {
  const normalizedConfig = normalizeModelConfigInput({ apiBaseUrl, apiKey });

  if (!normalizedConfig.apiBaseUrl || !normalizedConfig.apiKey || !selectedModel) {
    return {
      skipped: true,
      success: false,
      rawError: null,
      errorInfo: null,
    };
  }

  try {
    const result = await testAPIConnection(
      normalizedConfig.apiBaseUrl,
      normalizedConfig.apiKey,
      selectedModel,
      requestOptions
    );

    if (result.success) {
      return {
        skipped: false,
        success: true,
        result: result as ConnectionTestResult,
        rawError: null,
        errorInfo: null,
      };
    }

    return {
      skipped: false,
      success: false,
      result: result as ConnectionTestResult,
      rawError: result.error,
      errorInfo: getErrorDisplayInfo(result.error || '', { includeDetails: true }) as ErrorDisplayInfo,
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error || '');

    return {
      skipped: false,
      success: false,
      error,
      rawError,
      errorInfo: getErrorDisplayInfo(error as Error | string, { includeDetails: true }) as ErrorDisplayInfo,
    };
  }
}

export function detectConnectionParamError(message: string): ParamErrorInfo {
  return detectParamError(message) as ParamErrorInfo;
}

export function getAIConnectionErrorInfo(error: Error | string): ErrorDisplayInfo {
  return getErrorDisplayInfo(error, { includeDetails: true }) as ErrorDisplayInfo;
}
