/** AI 请求诊断的页面地址与返回操作由 App 承接。 */
import { useRouter } from 'expo-router';
import { AIRequestDiagnosticsScreen } from '@features/miniPrograms';

export default function AIRequestDiagnosticsRoute() {
  const router = useRouter();
  return <AIRequestDiagnosticsScreen onBack={() => router.back()} />;
}
