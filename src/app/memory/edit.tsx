/** 新建与编辑记忆只向 Feature 传递业务标识。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { MemoryEditorScreen } from '@features/memory';

export default function MemoryEditorRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ assistantId?: string | string[]; memoryId?: string | string[] }>();
  const assistantId = Array.isArray(params.assistantId) ? params.assistantId[0] : params.assistantId;
  const memoryId = Array.isArray(params.memoryId) ? params.memoryId[0] : params.memoryId;
  return assistantId ? <MemoryEditorScreen key={`${assistantId}:${memoryId ?? 'new'}`}
    assistantId={assistantId} memoryId={memoryId} onBack={() => router.back()}
  /> : <Redirect href={'/memory' as Href} />;
}
