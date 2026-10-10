/** 触发词关联详情路由。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { MemoryTriggerScreen } from '@features/memory';

export default function MemoryTriggerRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assistantId?: string | string[]; triggerId?: string | string[] }>();
  const assistantId = Array.isArray(params.assistantId) ? params.assistantId[0] : params.assistantId;
  const triggerId = Array.isArray(params.triggerId) ? params.triggerId[0] : params.triggerId;
  return assistantId && triggerId ? <MemoryTriggerScreen key={`${assistantId}:${triggerId}`}
    assistantId={assistantId} triggerId={triggerId} onBack={() => router.back()}
  /> : <Redirect href={'/memory' as Href} />;
}
