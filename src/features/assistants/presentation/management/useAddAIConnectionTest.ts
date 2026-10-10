// AddAIScreen 连接测试逻辑

import { showAppDialog } from '@shared/ui';
import { useState, useCallback } from 'react';

import { runConnectionTestByConfig } from './sharedModelConfig';

interface UseAddAIConnectionTestOptions {
  apiBaseUrl: string;
  apiKey: string;
  selectedModel: string;
}

interface UseAddAIConnectionTestResult {
  isTesting: boolean;
  testResult: 'success' | 'error' | null;
  resetConnectionTest: () => void;
  handleTestConnection: () => Promise<void>;
}

export default function useAddAIConnectionTest({
  apiBaseUrl,
  apiKey,
  selectedModel,
}: UseAddAIConnectionTestOptions): UseAddAIConnectionTestResult {
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const resetConnectionTest = useCallback(() => {
    setTestResult(null);
  }, []);

  const handleTestConnection = useCallback(async () => {
    if (!apiBaseUrl || !apiKey || !selectedModel) {
      return;
    }

    setIsTesting(true);
    resetConnectionTest();

    try {
      const result = await runConnectionTestByConfig({
        apiBaseUrl,
        apiKey,
        selectedModel,
        requestOptions: { skipParams: true },
      });

      if (result.success) {
        setTestResult('success');
        showAppDialog({ title: '连接成功', message: `模型「${selectedModel}」连接正常，可以保存。`, tone: 'success' });
      } else {
        setTestResult('error');
        const errorInfo = result.errorInfo;
        showAppDialog({ title: errorInfo.title, message: errorInfo.message, tone: 'error' });
        console.log('[AddAI] Test connection failed:', errorInfo.message);
      }
    } catch (error: any) {
      setTestResult('error');
      showAppDialog({ title: '连接错误', message: error.message || '测试连接时发生错误。', tone: 'error' });
      console.log('[AddAI] Test connection error:', error.message);
    } finally {
      setIsTesting(false);
    }
  }, [apiBaseUrl, apiKey, selectedModel, resetConnectionTest]);

  return {
    isTesting,
    testResult,
    resetConnectionTest,
    handleTestConnection,
  };
}
